// Boot smoke test over the Chrome DevTools Protocol: launches headless Chrome,
// loads the local ARGUS build, collects console output + uncaught exceptions
// for a fixed window, then reads the layer counters from the DOM.
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require(require('path').join(__dirname, '..', '..', 'node_modules', 'ws'));

const PORT = 9333;
const URL = process.argv[2] || 'http://127.0.0.1:8080/';
const WINDOW_MS = parseInt(process.argv[3] || '55000', 10);
const profile = require('path').join(require('os').tmpdir(), 'argus-smoke-profile');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const getJson = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej);
});

(async () => {
  const chrome = spawn('google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--no-first-run', '--disable-extensions',
    '--window-size=1280,800', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = list.find(t => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) { console.error('chrome did not expose a page target'); chrome.kill('SIGKILL'); process.exit(2); }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

  const consoleLines = [];
  const exceptions = [];
  const logEntries = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' ');
      consoleLines.push(`[${msg.params.type}] ${text}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      exceptions.push(`${d.text} ${d.exception ? d.exception.description : ''} @ ${d.url || ''}:${d.lineNumber}`);
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.level === 'error' || e.level === 'warning') logEntries.push(`[${e.source}/${e.level}] ${e.text} ${e.url || ''}`);
    }
  });

  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await sleep(WINDOW_MS);

  const expr = `(() => {
    const g = (id) => { const el = document.getElementById(id); return el ? el.textContent.trim() : null; };
    return JSON.stringify({
      loadingStatus: g('loading-status'),
      layerStatus: g('layer-status'),
      counts: {
        earthquakes: g('count-earthquakes'), conflicts: g('count-conflicts'), disasters: g('count-disasters'),
        antarctica: g('count-antarctica'), military: g('count-military'), intel: g('count-intel'),
      },
      stats: { conflicts: g('stat-conflicts'), disasters: g('stat-disasters'), quakes: g('stat-quakes') },
      disasterToggle: !!document.getElementById('toggle-disasters'),
      disasterStatTitle: (document.getElementById('stat-disasters') || {}).title || null,
      presetZ: !![...document.querySelectorAll('#preset-buttons .preset-key')].find(e => e.textContent.trim() === 'Z'),
      landingVisible: !!(document.getElementById('landing-overlay') || {}).classList?.contains('visible'),
      entityCount: (typeof Globe !== 'undefined' && Globe.getViewer()) ? Globe.getViewer().entities.values.length : null,
      hashAfterToggle: (() => { try { if (typeof Disasters !== 'undefined') { const before = Disasters.isVisible(); Disasters.setVisible(false); HashState.update(); Disasters.setVisible(before); } } catch (e) { return 'err ' + e.message; } return 'ok'; })(),
    });
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  const dom = r && r.result ? r.result.value : null;

  console.log('=== CONSOLE ===');
  consoleLines.filter(l => !/cesium\.com|This application is using Cesium/i.test(l)).forEach(l => console.log(l.slice(0, 300)));
  console.log('=== EXCEPTIONS (' + exceptions.length + ') ===');
  exceptions.forEach(e => console.log(e.slice(0, 500)));
  console.log('=== LOG ENTRIES (' + logEntries.length + ') ===');
  logEntries.slice(0, 25).forEach(e => console.log(e.slice(0, 220)));
  console.log('=== DOM ===');
  console.log(dom);

  ws.close();
  chrome.kill('SIGKILL');
  process.exit(exceptions.length ? 1 : 0);
})().catch(err => { console.error('SMOKE FAIL', err); process.exit(2); });
