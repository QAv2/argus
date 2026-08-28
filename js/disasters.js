// disasters.js — F11 Disasters layer
// Two sources rendered into one layer:
//   • Curated 2026 major events  — data/disasters.json (hand-verified, full dossier)
//   • Live GDACS alert feed      — JRC/UN Global Disaster Alert & Coordination System,
//                                  last 30 days, TC/FL/VO/DR/WF (EQ excluded: F1 is USGS).
//                                  CORS-open (ACAO *), so it is fetched directly, no proxy.
// Live items are sized by GDACS alert level (Red > Orange > Green); Green wildfires below
// 20,000 ha are dropped to keep the globe legible.

const Disasters = (() => {
  let curated = [];        // curated event records (with ._ms epoch)
  let live = [];           // GDACS records (normalised, with ._ms epoch)
  let entities = [];       // Cesium entities, 1:1 with `curated`
  let liveEntities = [];   // Cesium entities, 1:1 with `live`
  let liveHasLabel = [];   // per live entity: label allowed at all (Orange/Red only)
  let visible = true;
  let labelsVisible = true;
  let timeFilter = null;   // null = LIVE, epoch ms = timeline scrub
  let liveFetchInFlight = false;
  let liveFailures = 0;
  const iconCache = {};

  const CURATED_URL = 'data/disasters.json';
  const GDACS_BASE = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH';
  const GDACS_TYPES = 'TC;FL;VO;DR;WF';
  const GDACS_WINDOW_DAYS = 30;
  const GDACS_REFRESH_MS = 10 * 60 * 1000;
  const GDACS_TIMEOUT_MS = 30000;      // GDACS is slow to first byte; 15s tripped on a cold load
  const GDACS_RETRY_MS = 45000;        // quick retry after a failed poll (max 3) before the 10-min cadence
  const GDACS_GREEN_WF_MIN_HA = 20000;

  const TYPE_COLORS = {
    glacial: '#a5f3fc',
    avalanche: '#e0f2fe',
    landslide: '#d97706',
    flood: '#0ea5e9',
    wildfire: '#f97316',
    cyclone: '#a78bfa',
    tornado: '#c4b5fd',
    storm: '#818cf8',
    volcano: '#fb7185',
    heatwave: '#fde047',
    coldwave: '#bae6fd',
    drought: '#d6a55c',
    tsunami: '#14b8a6',
    earthquake: '#f87171',
    industrial: '#9ca3af',
    epidemic: '#84cc16',
  };
  const DEFAULT_COLOR = '#fb7185';

  const GDACS_TYPE = { TC: 'cyclone', FL: 'flood', VO: 'volcano', DR: 'drought', WF: 'wildfire', EQ: 'earthquake', TS: 'tsunami' };
  const ALERT_STYLE = {
    Red: { size: 22, label: true, alpha: 1.0 },
    Orange: { size: 18, label: true, alpha: 0.95 },
    Green: { size: 13, label: false, alpha: 0.7 },
  };

  // ── Boot ───────────────────────────────────────────────────────────────

  async function init(viewer) {
    const results = await Promise.allSettled([loadCurated(viewer), loadLive(viewer)]);
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.warn(`[Disasters] ${i === 0 ? 'curated' : 'GDACS'} load failed:`, r.reason);
    });
    setInterval(() => loadLive(viewer), GDACS_REFRESH_MS);
    updateStats();
    Globe.requestRender();
    console.log(`[Disasters] ${curated.length} curated + ${live.length} live GDACS alerts`);
  }

  async function loadCurated(viewer) {
    const resp = await fetch(CURATED_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    curated = (Array.isArray(data) ? data : []).map(e => ({ ...e, _ms: toMs(e.date) }));
    renderCurated(viewer);
  }

  function gdacsUrl() {
    const to = new Date();
    const from = new Date(to.getTime() - GDACS_WINDOW_DAYS * 86400000);
    const d = (x) => x.toISOString().slice(0, 10);
    return `${GDACS_BASE}?eventlist=${GDACS_TYPES}&alertlevel=Green;Orange;Red&fromDate=${d(from)}&toDate=${d(to)}`;
  }

  async function loadLive(viewer) {
    if (liveFetchInFlight) return;
    liveFetchInFlight = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), GDACS_TIMEOUT_MS);
    try {
      const resp = await fetch(gdacsUrl(), { signal: ctrl.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      live = normaliseGdacs(data.features || []);
      liveFailures = 0;
      renderLive(viewer);
      updateStats();
      Globe.requestRender();
    } catch (err) {
      liveFailures++;
      console.warn(`[Disasters] GDACS fetch failed (${liveFailures}):`, err.message);
      updateStats();
      if (liveFailures <= 3) setTimeout(() => loadLive(viewer), GDACS_RETRY_MS);
    } finally {
      clearTimeout(timer);
      liveFetchInFlight = false;
    }
  }

  // GDACS SEARCH → flat records. One record per event (latest episode wins).
  function normaliseGdacs(features) {
    const byEvent = new Map();
    features.forEach(f => {
      const p = f.properties || {};
      const g = f.geometry || {};
      if (g.type !== 'Point' || !Array.isArray(g.coordinates)) return;
      const type = GDACS_TYPE[p.eventtype] || 'storm';
      const alert = p.alertlevel || 'Green';
      const sev = p.severitydata || {};
      if (p.eventtype === 'WF' && alert === 'Green' && (Number(sev.severity) || 0) < GDACS_GREEN_WF_MIN_HA) return;

      const key = `${p.eventtype}-${p.eventid}`;
      const prev = byEvent.get(key);
      if (prev && Number(prev.episodeid) >= Number(p.episodeid)) return;

      const affected = Array.isArray(p.affectedcountries)
        ? p.affectedcountries.map(c => c.countryname || c.iso3).filter(Boolean).join(', ')
        : '';
      const urls = p.url || {};
      byEvent.set(key, {
        id: `gdacs-${key}`,
        episodeid: p.episodeid,
        name: p.name || p.eventname || `${type} alert`,
        lat: g.coordinates[1],
        lon: g.coordinates[0],
        type,
        alertLevel: alert,
        date: p.fromdate ? p.fromdate + (String(p.fromdate).endsWith('Z') ? '' : 'Z') : null,
        end_date: p.todate ? p.todate + (String(p.todate).endsWith('Z') ? '' : 'Z') : null,
        status: String(p.iscurrent) === 'true' ? 'ongoing' : 'concluded',
        region: p.country || affected || null,
        scale: sev.severitytext || null,
        casualties: null,
        displaced: null,
        cause: null,
        description: p.description && p.description !== p.name ? p.description : `${p.name || type} — GDACS ${alert} alert (score ${p.alertscore ?? '—'}).`,
        sources: urls.report ? [`GDACS report — ${urls.report}`] : [],
        feed: `GDACS live · ${p.eventtype} ${p.eventid}/${p.episodeid}` + (p.datemodified ? ` · updated ${String(p.datemodified).replace('T', ' ').slice(0, 16)} UTC` : ''),
      });
    });
    return Array.from(byEvent.values()).map(e => ({ ...e, _ms: toMs(e.date) }));
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  function renderCurated(viewer) {
    entities.forEach(e => viewer.entities.remove(e));
    entities = curated.map(evt => makeEntity(viewer, evt, {
      size: 22, label: true, alpha: 1.0, feed: 'ARGUS curated — verified against the sources listed',
    }));
    applyVisibility();
  }

  function renderLive(viewer) {
    liveEntities.forEach(e => viewer.entities.remove(e));
    liveEntities = [];
    liveHasLabel = [];
    live.forEach(evt => {
      const style = ALERT_STYLE[evt.alertLevel] || ALERT_STYLE.Green;
      liveEntities.push(makeEntity(viewer, evt, { ...style, feed: evt.feed }));
      liveHasLabel.push(style.label);
    });
    applyVisibility();
  }

  function makeEntity(viewer, evt, opts) {
    const color = TYPE_COLORS[evt.type] || DEFAULT_COLOR;
    const cesiumColor = Cesium.Color.fromCssColorString(color);
    const showLabel = labelsVisible && opts.label;
    return viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(evt.lon, evt.lat),
      billboard: {
        image: createIcon(evt.type, color),
        width: opts.size,
        height: opts.size,
        color: Cesium.Color.WHITE.withAlpha(opts.alpha),
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: 0,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: evt.name,
        font: '10px monospace',
        fillColor: cesiumColor.withAlpha(0.85),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.TOP,
        pixelOffset: new Cesium.Cartesian2(0, opts.size / 2 + 3),
        disableDepthTestDistance: 0,
        show: showLabel,
        scaleByDistance: new Cesium.NearFarScalar(1e5, 1, 5e6, 0.4),
      },
      properties: {
        type: 'disaster',
        id: evt.id,
        name: evt.name,
        lat: evt.lat,
        lon: evt.lon,
        eventType: evt.type,
        alertLevel: evt.alertLevel || null,
        status: evt.status || null,
        region: evt.region || null,
        date: evt.date || null,
        endDate: evt.end_date || null,
        scale: evt.scale || null,
        casualties: evt.casualties || null,
        displaced: evt.displaced || null,
        cause: evt.cause || null,
        description: evt.description || '',
        eventSources: (evt.sources || []).join(' | '),
        feed: opts.feed || null,
        eventColor: color,
        photoUrl: evt.photo_url || null,
      },
      show: visible,
    });
  }

  // ── Visibility / time / labels ─────────────────────────────────────────

  function passesTime(ms) {
    if (timeFilter === null) return true;
    if (!ms) return true;
    return ms <= timeFilter;
  }

  function applyVisibility() {
    entities.forEach((ent, i) => { ent.show = visible && passesTime(curated[i] && curated[i]._ms); });
    liveEntities.forEach((ent, i) => { ent.show = visible && passesTime(live[i] && live[i]._ms); });
  }

  function setVisible(v) {
    visible = v;
    applyVisibility();
    Globe.requestRender();
  }

  function isVisible() { return visible; }

  function setTime(epochMs) {
    timeFilter = epochMs || null;
    applyVisibility();
    Globe.requestRender();
  }

  function setLabelsVisible(show) {
    labelsVisible = show;
    entities.forEach(e => { if (e.label) e.label.show = show; });
    liveEntities.forEach((e, i) => { if (e.label) e.label.show = show && liveHasLabel[i]; });
  }

  function getCount() { return entities.length + liveEntities.length; }
  function getCurated() { return curated; }
  function getLive() { return live; }

  function updateStats() {
    const el = document.getElementById('stat-disasters');
    if (!el) return;
    const n = getCount();
    if (liveFailures > 0 && live.length === 0) {
      el.textContent = `${n} disasters (GDACS offline)`;
      el.setAttribute('data-degraded', 'true');
      el.title = 'GDACS live feed unreachable — showing curated events only';
    } else {
      el.textContent = `${n} disasters`;
      el.removeAttribute('data-degraded');
      el.title = `${curated.length} curated · ${live.length} live GDACS alerts (${GDACS_WINDOW_DAYS}d)`;
    }
  }

  function toMs(iso) {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    return isNaN(t) ? null : t;
  }

  // ── Icons (canvas, cached per type+color) ──────────────────────────────

  function createIcon(type, color) {
    const key = type + color;
    if (iconCache[key]) return iconCache[key];
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d');
    const cx = 12, cy = 12;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.fillStyle = color + '55';
    ctx.lineWidth = 1.5;

    switch (type) {
      case 'glacial': drawGlacial(ctx, cx, cy, color); break;
      case 'avalanche': drawAvalanche(ctx, cx, cy, color); break;
      case 'landslide': drawLandslide(ctx, cx, cy, color); break;
      case 'flood': drawFlood(ctx, cx, cy, color); break;
      case 'tsunami': drawTsunami(ctx, cx, cy, color); break;
      case 'wildfire': drawFlame(ctx, cx, cy, color); break;
      case 'cyclone': drawCyclone(ctx, cx, cy, color); break;
      case 'tornado': drawTornado(ctx, cx, cy, color); break;
      case 'storm': drawStorm(ctx, cx, cy, color); break;
      case 'volcano': drawVolcano(ctx, cx, cy, color); break;
      case 'heatwave': drawSun(ctx, cx, cy, color); break;
      case 'coldwave': drawSnowflake(ctx, cx, cy, color); break;
      case 'drought': drawDrought(ctx, cx, cy, color); break;
      case 'earthquake': drawQuake(ctx, cx, cy, color); break;
      case 'epidemic': drawVirus(ctx, cx, cy, color); break;
      case 'industrial':
      default: drawWarning(ctx, cx, cy, color); break;
    }

    const dataUrl = canvas.toDataURL();
    iconCache[key] = dataUrl;
    return dataUrl;
  }

  // Mountain silhouette with a sheared-off ice block dropping from the summit.
  function drawGlacial(ctx, cx, cy, color) {
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + 8);
    ctx.lineTo(cx - 3, cy - 4);
    ctx.lineTo(cx, cy - 1);
    ctx.lineTo(cx + 4, cy - 8);
    ctx.lineTo(cx + 10, cy + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // detached block
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + 5, cy - 9);
    ctx.lineTo(cx + 9, cy - 10);
    ctx.lineTo(cx + 10, cy - 6);
    ctx.lineTo(cx + 6, cy - 5);
    ctx.closePath();
    ctx.fill();
    // fracture line
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + 4, cy - 7);
    ctx.lineTo(cx + 2, cy - 3);
    ctx.lineTo(cx + 5, cy + 1);
    ctx.lineTo(cx + 3, cy + 5);
    ctx.stroke();
  }

  // Mountain with a broad downward chevron (snow slab release).
  function drawAvalanche(ctx, cx, cy, color) {
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + 8);
    ctx.lineTo(cx, cy - 8);
    ctx.lineTo(cx + 10, cy + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy - 1); ctx.lineTo(cx, cy + 3); ctx.lineTo(cx + 4, cy - 1);
    ctx.moveTo(cx - 4, cy + 3); ctx.lineTo(cx, cy + 7); ctx.lineTo(cx + 4, cy + 3);
    ctx.stroke();
  }

  // Slope wedge with debris tumbling down the face.
  function drawLandslide(ctx, cx, cy, color) {
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy - 8);
    ctx.lineTo(cx - 10, cy + 8);
    ctx.lineTo(cx + 10, cy + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    [[-3, -3], [1, 1], [5, 5], [-1, 4]].forEach(([dx, dy]) => {
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, 1.4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Three stacked waves.
  function drawFlood(ctx, cx, cy, color) {
    ctx.lineWidth = 2;
    [-5, 0, 5].forEach((dy, i) => {
      ctx.globalAlpha = i === 0 ? 1 : 0.75;
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy + dy);
      ctx.quadraticCurveTo(cx - 7, cy + dy - 4, cx - 4, cy + dy);
      ctx.quadraticCurveTo(cx - 1, cy + dy + 4, cx + 2, cy + dy);
      ctx.quadraticCurveTo(cx + 5, cy + dy - 4, cx + 8, cy + dy);
      ctx.quadraticCurveTo(cx + 9, cy + dy - 1.5, cx + 10, cy + dy);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  // Single breaking wave with a curl.
  function drawTsunami(ctx, cx, cy, color) {
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + 8);
    ctx.quadraticCurveTo(cx - 8, cy - 8, cx + 2, cy - 8);
    ctx.quadraticCurveTo(cx + 10, cy - 8, cx + 8, cy - 1);
    ctx.quadraticCurveTo(cx + 6, cy + 3, cx + 2, cy + 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + 8);
    ctx.lineTo(cx + 10, cy + 8);
    ctx.stroke();
  }

  function drawFlame(ctx, cx, cy, color) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 10);
    ctx.bezierCurveTo(cx + 2, cy - 5, cx + 9, cy - 3, cx + 7, cy + 4);
    ctx.bezierCurveTo(cx + 6, cy + 8, cx + 3, cy + 10, cx, cy + 10);
    ctx.bezierCurveTo(cx - 4, cy + 10, cx - 8, cy + 7, cx - 7, cy + 2);
    ctx.bezierCurveTo(cx - 6, cy - 2, cx - 3, cy - 4, cx - 2, cy - 7);
    ctx.bezierCurveTo(cx - 1, cy - 8, cx, cy - 9, cx, cy - 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + 1, cy);
    ctx.bezierCurveTo(cx + 4, cy + 3, cx + 3, cy + 8, cx, cy + 8);
    ctx.bezierCurveTo(cx - 3, cy + 8, cx - 4, cy + 4, cx - 1, cy + 2);
    ctx.closePath();
    ctx.fill();
  }

  // Two-arm spiral.
  function drawCyclone(ctx, cx, cy, color) {
    ctx.lineWidth = 2;
    for (let arm = 0; arm < 2; arm++) {
      ctx.beginPath();
      for (let t = 0; t <= Math.PI * 1.6; t += 0.15) {
        const r = 1.5 + t * 2.6;
        const a = t + arm * Math.PI;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Funnel: stacked shrinking bars.
  function drawTornado(ctx, cx, cy, color) {
    ctx.lineWidth = 2.2;
    const rows = [[-9, 10], [-5, 7], [-1, 4.5], [3, 2.5], [7, 1.2]];
    rows.forEach(([dy, hw], i) => {
      const shift = i * 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - hw + shift, cy + dy);
      ctx.lineTo(cx + hw + shift, cy + dy);
      ctx.stroke();
    });
  }

  // Cloud with lightning bolt.
  function drawStorm(ctx, cx, cy, color) {
    ctx.beginPath();
    ctx.arc(cx - 4, cy - 2, 4, Math.PI * 0.5, Math.PI * 1.5);
    ctx.arc(cx, cy - 5, 4.5, Math.PI, Math.PI * 2);
    ctx.arc(cx + 5, cy - 2, 3.5, Math.PI * 1.5, Math.PI * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + 1, cy + 2);
    ctx.lineTo(cx - 3, cy + 7);
    ctx.lineTo(cx, cy + 7);
    ctx.lineTo(cx - 1, cy + 11);
    ctx.lineTo(cx + 4, cy + 5);
    ctx.lineTo(cx + 1, cy + 5);
    ctx.closePath();
    ctx.fill();
  }

  // Truncated cone with an eruption plume.
  function drawVolcano(ctx, cx, cy, color) {
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy + 9);
    ctx.lineTo(cx - 3, cy - 3);
    ctx.lineTo(cx + 3, cy - 3);
    ctx.lineTo(cx + 10, cy + 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy - 10);
    ctx.moveTo(cx - 2, cy - 4); ctx.lineTo(cx - 6, cy - 9);
    ctx.moveTo(cx + 2, cy - 4); ctx.lineTo(cx + 6, cy - 9);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy - 4, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSun(ctx, cx, cy, color) {
    ctx.fillStyle = color + '88';
    ctx.beginPath();
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(cx + 6.5 * Math.cos(a), cy + 6.5 * Math.sin(a));
      ctx.lineTo(cx + 10 * Math.cos(a), cy + 10 * Math.sin(a));
      ctx.stroke();
    }
  }

  function drawSnowflake(ctx, cx, cy, color) {
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI) / 3;
      const dx = Math.cos(a), dy = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(cx - 10 * dx, cy - 10 * dy);
      ctx.lineTo(cx + 10 * dx, cy + 10 * dy);
      ctx.stroke();
      [6, -6].forEach(s => {
        const px = cx + s * dx, py = cy + s * dy;
        const b1 = a + Math.PI / 6 * (s > 0 ? 1 : -1) + (s > 0 ? Math.PI : 0);
        const b2 = a - Math.PI / 6 * (s > 0 ? 1 : -1) + (s > 0 ? Math.PI : 0);
        ctx.beginPath();
        ctx.moveTo(px, py); ctx.lineTo(px + 3 * Math.cos(b1), py + 3 * Math.sin(b1));
        ctx.moveTo(px, py); ctx.lineTo(px + 3 * Math.cos(b2), py + 3 * Math.sin(b2));
        ctx.stroke();
      });
    }
  }

  // Cracked-earth disc.
  function drawDrought(ctx, cx, cy, color) {
    ctx.beginPath();
    ctx.arc(cx, cy, 9.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 2); ctx.lineTo(cx - 3, cy); ctx.lineTo(cx - 1, cy + 8);
    ctx.moveTo(cx - 3, cy); ctx.lineTo(cx + 1, cy - 8);
    ctx.moveTo(cx - 3, cy); ctx.lineTo(cx + 9, cy + 2);
    ctx.moveTo(cx + 3, cy + 1); ctx.lineTo(cx + 5, cy + 7);
    ctx.stroke();
  }

  function drawQuake(ctx, cx, cy, color) {
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx - 6, cy);
    ctx.lineTo(cx - 4, cy - 8);
    ctx.lineTo(cx - 1, cy + 8);
    ctx.lineTo(cx + 2, cy - 5);
    ctx.lineTo(cx + 4, cy + 3);
    ctx.lineTo(cx + 6, cy);
    ctx.lineTo(cx + 10, cy);
    ctx.stroke();
  }

  // Spiked circle.
  function drawVirus(ctx, cx, cy, color) {
    ctx.beginPath();
    ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(cx + 5.5 * Math.cos(a), cy + 5.5 * Math.sin(a));
      ctx.lineTo(cx + 9 * Math.cos(a), cy + 9 * Math.sin(a));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + 9.5 * Math.cos(a), cy + 9.5 * Math.sin(a), 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Hazard triangle with exclamation mark.
  function drawWarning(ctx, cx, cy, color) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - 9);
    ctx.lineTo(cx + 10, cy + 8);
    ctx.lineTo(cx - 10, cy + 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(cx - 1, cy - 3, 2, 6);
    ctx.beginPath();
    ctx.arc(cx, cy + 5.5, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  return { init, setVisible, isVisible, getCount, setLabelsVisible, setTime, getCurated, getLive };
})();
