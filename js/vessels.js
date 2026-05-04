// vessels.js — Naval vessel tracking via server-side proxy to aisstream.io
// Browser WebSocket connections are rejected by aisstream.io (Origin header check).
// The Netlify Function at /.netlify/functions/vessels connects server-side,
// collects ~4 seconds of AIS data, filters for military vessels, returns JSON.
// This client polls the function every 30 seconds.
//
// Performance notes:
// - BillboardCollection for type-specific icons (single GPU draw call)
// - PolylineCollection for track history (Primitive API, delta updates)
// - No Entity API usage — avoids heavyweight tracked objects

const Vessels = (() => {
  let billboardCollection = null;
  let labelCollection = null;
  let trackPolylines = null;
  const billboardMap = new Map();     // MMSI -> Billboard
  const labelMap = new Map();         // MMSI -> Label
  const vesselData = new Map();       // MMSI -> vessel object
  const trackPolylineMap = new Map(); // MMSI -> Polyline

  let visible = true;
  let labelsVisible = true;
  let pollTimer = null;
  let pruneTimer = null;
  let fetchInFlight = false;

  const POLL_URL = '/.netlify/functions/vessels';
  const POLL_INTERVAL = 30000;  // 30s between polls
  const FETCH_TIMEOUT_MS = 25000;
  const STALE_MS = 10 * 60 * 1000; // 10 min
  const PRUNE_INTERVAL = 60000;

  // === Ship type color map ===
  const TYPE_COLORS = {
    35: { hex: '#ef4444', name: 'Military Ops' },
    55: { hex: '#06b6d4', name: 'Law Enforcement' },
    50: { hex: '#a855f7', name: 'Pilot Vessel' },
    51: { hex: '#f59e0b', name: 'Search & Rescue' },
    52: { hex: '#84cc16', name: 'Tug' },
    53: { hex: '#84cc16', name: 'Port Tender' },
    58: { hex: '#f43f5e', name: 'Medical Transport' },
  };
  const DEFAULT_COLOR_HEX = '#3b82f6';

  // Pre-cache Cesium colors for labels and tracks
  const typeColorCache = new Map();
  for (const [code, info] of Object.entries(TYPE_COLORS)) {
    typeColorCache.set(Number(code), {
      label: Cesium.Color.fromCssColorString(info.hex).withAlpha(0.7),
      track: Cesium.Color.fromCssColorString(info.hex).withAlpha(0.4),
    });
  }
  const defaultColors = {
    label: Cesium.Color.fromCssColorString(DEFAULT_COLOR_HEX).withAlpha(0.7),
    track: Cesium.Color.fromCssColorString(DEFAULT_COLOR_HEX).withAlpha(0.4),
  };

  function getTypeColors(shipType) {
    return typeColorCache.get(shipType) || defaultColors;
  }

  // === Icon generation — canvas shapes per ship type ===
  const ICON_SIZE = 24;
  const ICON_SHAPES = {
    35: 'diamond',    // Military — ◆
    55: 'pentagon',   // Law Enforcement — ⬠
    50: 'circle',     // Pilot — ●
    51: 'plus',       // SAR — ✚
    52: 'triangle',   // Tug — ▲
    53: 'triangle',   // Port Tender — ▲
    58: 'medical',    // Medical — ● with ✚
  };

  const iconCache = new Map();

  function buildIconCache() {
    for (const [code, info] of Object.entries(TYPE_COLORS)) {
      const shape = ICON_SHAPES[code] || 'dot';
      iconCache.set(Number(code), drawIcon(shape, info.hex));
    }
    iconCache.set('default', drawIcon('dot', DEFAULT_COLOR_HEX));
  }

  function getIcon(shipType) {
    return iconCache.get(shipType) || iconCache.get('default');
  }

  function drawIcon(shape, colorHex) {
    const s = ICON_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext('2d');
    const cx = s / 2;
    const cy = s / 2;
    const r = s / 2 - 2;

    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 2;
    ctx.fillStyle = colorHex;
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;

    switch (shape) {
      case 'diamond':
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r, cy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;

      case 'pentagon':
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i * 2 * Math.PI / 5);
          const px = cx + r * Math.cos(a);
          const py = cy + r * Math.sin(a);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;

      case 'circle':
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;

      case 'plus': {
        const w = 5;
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, cy - r);
        ctx.lineTo(cx + w / 2, cy - r);
        ctx.lineTo(cx + w / 2, cy - w / 2);
        ctx.lineTo(cx + r, cy - w / 2);
        ctx.lineTo(cx + r, cy + w / 2);
        ctx.lineTo(cx + w / 2, cy + w / 2);
        ctx.lineTo(cx + w / 2, cy + r);
        ctx.lineTo(cx - w / 2, cy + r);
        ctx.lineTo(cx - w / 2, cy + w / 2);
        ctx.lineTo(cx - r, cy + w / 2);
        ctx.lineTo(cx - r, cy - w / 2);
        ctx.lineTo(cx - w / 2, cy - w / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }

      case 'triangle':
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r * 0.9, cy + r * 0.7);
        ctx.lineTo(cx - r * 0.9, cy + r * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;

      case 'medical':
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        const cw = 4;
        const cr = r - 4;
        ctx.fillRect(cx - cw / 2, cy - cr, cw, cr * 2);
        ctx.fillRect(cx - cr, cy - cw / 2, cr * 2, cw);
        break;

      default: // 'dot'
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
    }

    return canvas;
  }

  // Build icon cache immediately
  buildIconCache();

  // === Ship type names ===
  const SHIP_TYPE_NAMES = {
    20: 'Wing in Ground', 21: 'WIG Carrying DG/HS/MP', 29: 'WIG (No info)',
    30: 'Fishing', 31: 'Towing', 32: 'Towing (Large)', 33: 'Dredging/Underwater Ops',
    34: 'Diving Operations', 35: 'Military Operations', 36: 'Sailing', 37: 'Pleasure Craft',
    40: 'High Speed Craft', 41: 'HSC Carrying DG/HS/MP', 49: 'HSC (No info)',
    50: 'Pilot Vessel', 51: 'Search & Rescue', 52: 'Tug', 53: 'Port Tender',
    54: 'Anti-pollution', 55: 'Law Enforcement', 56: 'Spare (Local)', 57: 'Spare (Local)',
    58: 'Medical Transport', 59: 'Noncombatant (RR No.18)',
    60: 'Passenger', 69: 'Passenger (No info)',
    70: 'Cargo', 79: 'Cargo (No info)',
    80: 'Tanker', 89: 'Tanker (No info)',
    90: 'Other', 99: 'Other (No info)',
  };

  function getShipTypeName(code) {
    if (code == null) return 'Unknown';
    return SHIP_TYPE_NAMES[code] || `Type ${code}`;
  }

  // Country code → flag emoji
  function countryToFlag(code) {
    if (!code || code === '??') return '';
    return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  }

  // Cached layout constants
  const LABEL_OFFSET = new Cesium.Cartesian2(0, -10);
  const LABEL_SCALE = new Cesium.NearFarScalar(1e5, 1, 5e6, 0.3);
  const BB_SCALE = new Cesium.NearFarScalar(1e5, 1.0, 8e6, 0.4);

  // Track history
  const trackHistory = new Map(); // MMSI → [{lon, lat, time}]
  const MAX_TRACK_POINTS = 50;

  // AIS navigation status codes
  const NAV_STATUS = {
    0: 'Under way using engine', 1: 'At anchor', 2: 'Not under command',
    3: 'Restricted maneuverability', 4: 'Constrained by draught', 5: 'Moored',
    6: 'Aground', 7: 'Engaged in fishing', 8: 'Under way sailing',
    9: 'Reserved (HSC)', 10: 'Reserved (WIG)', 11: 'Towing astern',
    12: 'Pushing/towing', 14: 'AIS-SART', 15: 'Not defined',
  };

  // MID → country code
  const MID_FLAGS = {
    '211': 'DE', '226': 'FR', '227': 'FR', '228': 'FR',
    '230': 'FI', '232': 'GB', '233': 'GB', '234': 'GB', '235': 'GB',
    '244': 'NL', '245': 'NL', '246': 'NL',
    '247': 'IT', '248': 'MT', '257': 'NO', '258': 'NO', '259': 'NO',
    '261': 'PL', '265': 'SE', '266': 'SE',
    '273': 'RU', '274': 'RU',
    '303': 'US', '338': 'US', '366': 'US', '367': 'US', '368': 'US', '369': 'US',
    '316': 'CA', '401': 'AF', '412': 'CN', '413': 'CN', '414': 'CN',
    '431': 'JP', '432': 'JP', '440': 'KR', '441': 'KR',
    '503': 'AU', '512': 'NZ',
  };

  function getFlag(mmsi) {
    return MID_FLAGS[String(mmsi).slice(0, 3)] || '??';
  }

  // === Init ===
  function init(viewer) {
    billboardCollection = viewer.scene.primitives.add(new Cesium.BillboardCollection());
    labelCollection = viewer.scene.primitives.add(new Cesium.LabelCollection());
    trackPolylines = viewer.scene.primitives.add(new Cesium.PolylineCollection());

    // First fetch immediately, then poll
    fetchVessels();
    pollTimer = setInterval(fetchVessels, POLL_INTERVAL);
    pruneTimer = setInterval(pruneStale, PRUNE_INTERVAL);
  }

  async function fetchVessels() {
    if (fetchInFlight) return;
    fetchInFlight = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(POLL_URL, { signal: controller.signal });
      if (!resp.ok) {
        console.warn('[Vessels] Fetch failed:', resp.status);
        return;
      }

      const batch = await resp.json();
      if (!Array.isArray(batch)) {
        console.warn('[Vessels] Unexpected response format');
        return;
      }

      const now = Date.now();
      for (const v of batch) {
        const prev = vesselData.get(v.mmsi);
        vesselData.set(v.mmsi, {
          mmsi: v.mmsi,
          name: v.name || '',
          callsign: v.callsign || null,
          shipType: v.shipType || null,
          flag: getFlag(v.mmsi),
          lat: v.lat,
          lon: v.lon,
          speed: v.speed,
          course: v.course,
          heading: v.heading,
          status: v.status,
          lastUpdate: now,
        });

        // Record track history (only when position changes)
        if (!prev || prev.lat !== v.lat || prev.lon !== v.lon) {
          let track = trackHistory.get(v.mmsi);
          if (!track) {
            track = [];
            trackHistory.set(v.mmsi, track);
          }
          track.push({ lon: v.lon, lat: v.lat, time: now });
          if (track.length > MAX_TRACK_POINTS) track.shift();
        }
      }

      reconcileRender();
      updateStats();
      Globe.requestRender();
      console.log('[Vessels] Polled:', batch.length, 'vessels, total tracked:', vesselData.size);
    } catch (err) {
      const msg = err.name === 'AbortError' ? 'timeout' : err.message;
      console.warn('[Vessels] Poll error:', msg);
    } finally {
      clearTimeout(timeoutId);
      fetchInFlight = false;
    }
  }

  function makeLabelText(vessel) {
    const flag = countryToFlag(vessel.flag);
    const name = vessel.name || String(vessel.mmsi);
    return flag ? `${flag} ${name}` : name;
  }

  function reconcileRender() {
    // Update existing / remove departed billboards
    for (const [mmsi, billboard] of billboardMap) {
      const vessel = vesselData.get(mmsi);
      if (vessel) {
        const colors = getTypeColors(vessel.shipType);
        const pos = Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat, 100);
        billboard.position = pos;
        billboard.image = getIcon(vessel.shipType);
        billboard.id = makePickData(vessel);
        const label = labelMap.get(mmsi);
        if (label) {
          label.position = pos;
          label.text = makeLabelText(vessel);
          label.fillColor = colors.label;
          label.id = billboard.id;
        }
      } else {
        billboardCollection.remove(billboard);
        billboardMap.delete(mmsi);
        const label = labelMap.get(mmsi);
        if (label) {
          labelCollection.remove(label);
          labelMap.delete(mmsi);
        }
      }
    }

    // Add new billboards
    for (const [mmsi, vessel] of vesselData) {
      if (billboardMap.has(mmsi)) continue;

      const colors = getTypeColors(vessel.shipType);
      const pos = Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat, 100);
      const pickData = makePickData(vessel);

      const billboard = billboardCollection.add({
        position: pos,
        image: getIcon(vessel.shipType),
        scale: 0.5,
        disableDepthTestDistance: 0,
        scaleByDistance: BB_SCALE,
        id: pickData,
        show: visible,
      });
      billboardMap.set(mmsi, billboard);

      const label = labelCollection.add({
        position: pos,
        text: makeLabelText(vessel),
        font: '10px monospace',
        fillColor: colors.label,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: LABEL_OFFSET,
        disableDepthTestDistance: 0,
        scaleByDistance: LABEL_SCALE,
        id: pickData,
        show: visible && labelsVisible,
      });
      labelMap.set(mmsi, label);
    }

    // Delta-update track polylines (no removeAll rebuild)
    updateTrackPolylines();
  }

  function updateTrackPolylines() {
    // Update existing track polylines
    for (const [mmsi, polyline] of trackPolylineMap) {
      const track = trackHistory.get(mmsi);
      const vessel = vesselData.get(mmsi);
      if (track && track.length >= 2 && vessel) {
        polyline.positions = track.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 50));
        polyline.show = visible;
      } else {
        trackPolylines.remove(polyline);
        trackPolylineMap.delete(mmsi);
      }
    }

    // Add polylines for new tracks
    for (const [mmsi, track] of trackHistory) {
      if (track.length < 2 || trackPolylineMap.has(mmsi)) continue;
      const vessel = vesselData.get(mmsi);
      if (!vessel) continue;
      const colors = getTypeColors(vessel.shipType);
      const positions = track.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 50));
      const polyline = trackPolylines.add({
        positions,
        width: 1.5,
        material: Cesium.Material.fromType('Color', { color: colors.track }),
        show: visible,
      });
      trackPolylineMap.set(mmsi, polyline);
    }
  }

  function makePickData(v) {
    return {
      type: 'vessel',
      mmsi: v.mmsi,
      name: v.name,
      callsign: v.callsign,
      shipType: v.shipType,
      flag: v.flag,
      lat: v.lat,
      lon: v.lon,
      speed: v.speed,
      course: v.course,
      heading: v.heading,
      status: v.status,
      lastUpdate: v.lastUpdate,
    };
  }

  function pruneStale() {
    const now = Date.now();
    let pruned = 0;
    for (const [mmsi, vessel] of vesselData) {
      if (now - vessel.lastUpdate > STALE_MS) {
        vesselData.delete(mmsi);
        trackHistory.delete(mmsi);
        pruned++;
      }
    }
    if (pruned > 0) {
      reconcileRender();
      updateStats();
      Globe.requestRender();
    }
  }

  function setVisible(v) {
    visible = v;
    if (billboardCollection) billboardCollection.show = v;
    if (labelCollection) labelCollection.show = v && labelsVisible;
    if (trackPolylines) {
      for (let i = 0; i < trackPolylines.length; i++) {
        trackPolylines.get(i).show = v;
      }
    }
    Globe.requestRender();
  }

  function isVisible() { return visible; }

  function setLabelsVisible(show) {
    labelsVisible = show;
    if (labelCollection) labelCollection.show = visible && show;
  }

  function getCount() { return billboardMap.size; }

  function getVesselByMMSI(mmsi) {
    return vesselData.get(mmsi) || null;
  }

  function getNavStatusText(code) {
    return NAV_STATUS[code] || 'Unknown';
  }

  function updateStats() {
    const el = document.getElementById('stat-vessels');
    if (el) el.textContent = `${billboardMap.size} vessels`;
  }

  return {
    init, setVisible, isVisible, getCount, setLabelsVisible,
    getVesselByMMSI, getNavStatusText, getShipTypeName, countryToFlag,
    getTypeColorHex: (shipType) => (TYPE_COLORS[shipType]?.hex || DEFAULT_COLOR_HEX),
  };
})();
