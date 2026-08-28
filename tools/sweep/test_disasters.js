// Node harness: runs js/disasters.js in a vm sandbox with stubbed Cesium/DOM,
// feeds it the real GDACS payload (gd.json) + the curated file, and exercises
// init / setTime / setVisible / setLabelsVisible / stats.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const here = __dirname;
const noop = () => {};
const ctxStub = new Proxy({}, {
  get: (t, k) => (k === 'globalAlpha' || k === 'lineWidth' ? 1 : noop),
  set: () => true,
});
const elements = {};
const document = {
  createElement: (tag) => tag === 'canvas'
    ? { width: 0, height: 0, getContext: () => ctxStub, toDataURL: () => 'data:image/png;base64,x' }
    : { textContent: '', innerHTML: '', style: {} },
  getElementById: (id) => (elements[id] = elements[id] || {
    textContent: '', title: '', attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
  }),
};
const Cesium = {
  Color: {
    fromCssColorString: (s) => ({ css: s, withAlpha: (a) => ({ css: s, a }) }),
    WHITE: { withAlpha: (a) => ({ css: '#fff', a }) },
    BLACK: {},
  },
  Cartesian3: { fromDegrees: (lon, lat) => ({ lon, lat }) },
  Cartesian2: function (x, y) { this.x = x; this.y = y; },
  VerticalOrigin: { CENTER: 0, TOP: 1 },
  HeightReference: { CLAMP_TO_GROUND: 1 },
  LabelStyle: { FILL_AND_OUTLINE: 2 },
  NearFarScalar: function () {},
};
const Globe = { requestRender: noop };
const added = [];
const viewer = {
  entities: {
    add: (e) => { added.push(e); return e; },
    remove: (e) => { const i = added.indexOf(e); if (i >= 0) added.splice(i, 1); },
  },
};

const gd = JSON.parse(fs.readFileSync(process.env.GDACS_SAMPLE || path.join(here, 'fixtures', 'gdacs-sample.json')));
let curated;
try {
  curated = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'data', 'disasters.json')));
} catch {
  curated = [{
    id: 'sample-langtang', name: 'Langtang Lirung Glacier Collapse', lat: 28.2556, lon: 85.5167,
    type: 'glacial', date: '2026-08-26T04:45:00Z', end_date: null, status: 'ongoing',
    region: 'Rasuwa, Nepal', scale: 'sample', casualties: 'sample', displaced: null, cause: null,
    description: 'sample', sources: ['CNN — https://www.cnn.com/x'],
  }];
}

const fetchLog = [];
const sandbox = {
  console, document, Cesium, Globe, Promise, Map, Array, Number, String, Date, isNaN, Math, Object,
  fetch: async (url, opts) => {
    fetchLog.push(url);
    if (url.includes('gdacs')) return { ok: true, json: async () => gd };
    return { ok: true, json: async () => curated };
  },
  AbortController: class { constructor() { this.signal = {}; } abort() {} },
  setInterval: () => 0,
  setTimeout: () => 0,
  clearTimeout: noop,
};
vm.createContext(sandbox);
const src = fs.readFileSync(path.join(here, '..', '..', 'js', 'disasters.js'), 'utf8');
vm.runInContext(src + '\n; this.Disasters = Disasters;', sandbox);

(async () => {
  const D = sandbox.Disasters;
  await D.init(viewer);
  console.log('fetched:', fetchLog.map(u => u.slice(0, 110)));
  console.log('count', D.getCount(), '| curated', D.getCurated().length, '| live', D.getLive().length);
  const st = elements['stat-disasters'];
  console.log('stat:', st.textContent, '|', st.title, '| degraded attr:', st.attrs['data-degraded']);

  const byType = {};
  added.forEach(e => { const t = e.properties.eventType; byType[t] = (byType[t] || 0) + 1; });
  console.log('entities by type:', byType);
  const byAlert = {};
  D.getLive().forEach(e => { byAlert[e.alertLevel] = (byAlert[e.alertLevel] || 0) + 1; });
  console.log('live by alert:', byAlert);

  D.setTime(Date.UTC(2026, 7, 20));
  console.log('setTime(Aug 20): shown', added.filter(e => e.show).length, '/', added.length);
  D.setTime(null);
  console.log('setTime(null): shown', added.filter(e => e.show).length);
  D.setVisible(false);
  console.log('setVisible(false): shown', added.filter(e => e.show).length);
  D.setVisible(true);
  D.setLabelsVisible(false);
  console.log('labels off:', added.filter(e => e.label.show).length);
  D.setLabelsVisible(true);
  console.log('labels on:', added.filter(e => e.label.show).length, '(expect curated + Orange/Red live only)');

  const nepal = added.find(e => /Nepal/.test(e.properties.name) && e.properties.alertLevel);
  console.log('GDACS Nepal entity props:', JSON.stringify(nepal && nepal.properties, null, 1));
  const bad = added.filter(e => typeof e.properties.lat !== 'number' || typeof e.properties.lon !== 'number' || !e.properties.name);
  console.log('entities with bad lat/lon/name:', bad.length);
  const sizes = {};
  added.forEach(e => { sizes[e.billboard.width] = (sizes[e.billboard.width] || 0) + 1; });
  console.log('icon sizes:', sizes);
})().catch(err => { console.error('HARNESS FAIL', err); process.exit(1); });
