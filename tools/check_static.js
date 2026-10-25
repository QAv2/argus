// Static smoke check: no browser, no network, no dependencies.
// Catches a broken deploy before it ships — a missing local asset, a JS file
// that no longer parses, a data file that is empty or invalid JSON, or a
// theater listed in js/conflicts.js without its data file.
// Usage: node tools/check_static.js   (exit 1 on any failure)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const rel = (p) => path.relative(ROOT, p);
const failures = [];
let checked = 0;
const check = (ok, msg) => { checked++; if (!ok) failures.push(msg); };

// 1. Every local src/href in index.html exists
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const [, ref] of html.matchAll(/(?:src|href)="([^"#?]+)/g)) {
  if (/^(https?:)?\/\//.test(ref) || ref.startsWith('data:') || ref.startsWith('mailto:')) continue;
  check(fs.existsSync(path.join(ROOT, ref)), `index.html references missing file: ${ref}`);
}

// 2. Every JS file parses
const jsFiles = [
  ...fs.readdirSync(path.join(ROOT, 'js')).map(f => path.join(ROOT, 'js', f)),
  ...fs.readdirSync(path.join(ROOT, 'netlify', 'functions')).map(f => path.join(ROOT, 'netlify', 'functions', f)),
].filter(f => f.endsWith('.js'));
for (const f of jsFiles) {
  try { new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }); checked++; }
  catch (e) { failures.push(`${rel(f)} does not parse: ${e.message}`); }
}

// 3. Every literal data/... path fetched by the front end exists
const jsSrc = jsFiles.filter(f => f.includes(`${path.sep}js${path.sep}`)).map(f => fs.readFileSync(f, 'utf8')).join('\n');
for (const [, ref] of jsSrc.matchAll(/['"](data\/[A-Za-z0-9_./-]+\.json)['"]/g)) {
  check(fs.existsSync(path.join(ROOT, ref)), `front end fetches missing file: ${ref}`);
}

// 4. Each theater in js/conflicts.js has a non-empty data file
const conflicts = fs.readFileSync(path.join(ROOT, 'js', 'conflicts.js'), 'utf8');
const theaterIds = [...conflicts.matchAll(/\{\s*id:\s*'([a-z0-9-]+)',\s*name:/g)].map(m => m[1]);
check(theaterIds.length > 0, 'no theaters found in js/conflicts.js');

// 5. Data files parse and the ones the globe depends on are non-empty
const minItems = {
  'data/disasters.json': 1,
  'data/military-bases.json': 1,
  'data/bases.json': 1,
  'data/presets.json': 1,
  'data/roads.json': 1,
  'data/replays/index.json': 0,
  ...Object.fromEntries(theaterIds.map(id => [`data/theaters/${id}.json`, 1])),
};
const dataFiles = new Set([
  ...fs.readdirSync(path.join(ROOT, 'data')).filter(f => f.endsWith('.json')).map(f => `data/${f}`),
  ...fs.readdirSync(path.join(ROOT, 'data', 'theaters')).map(f => `data/theaters/${f}`),
  ...Object.keys(minItems),
]);
for (const f of dataFiles) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { failures.push(`missing data file: ${f}`); continue; }
  let d;
  try { d = JSON.parse(fs.readFileSync(p, 'utf8')); checked++; }
  catch (e) { failures.push(`${f} is not valid JSON: ${e.message}`); continue; }
  if (f in minItems) {
    const n = Array.isArray(d) ? d.length : Object.keys(d).length;
    check(n >= minItems[f], `${f} has ${n} items, expected at least ${minItems[f]}`);
  }
}

// 6. Antarctica layer has stations
const ant = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'antarctica.json'), 'utf8'));
check(Array.isArray(ant.research_stations) && ant.research_stations.length > 0, 'data/antarctica.json has no research_stations');

if (failures.length) {
  console.error(`FAIL: ${failures.length} problem(s)`);
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log(`OK: ${checked} checks passed (${jsFiles.length} JS files, ${dataFiles.size} data files, ${theaterIds.length} theaters)`);
