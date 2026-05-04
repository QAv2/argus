// conflicts.js — F9 conflict events layer (8 global theaters)

const Conflicts = (() => {
  let entities = [];
  let visible = true;
  let eventData = [];
  const iconCache = {};

  const TYPE_COLORS = {
    airstrike: '#ef4444',
    missile: '#dc2626',
    naval: '#3b82f6',
    retaliation: '#f97316',
    blockade: '#f59e0b',
    cyber: '#06b6d4',
    nuclear: '#a855f7',
    ground: '#22c55e',
    political: '#8b5cf6',
    economic: '#14b8a6',
  };

  const THEATERS = [
    { id: 'iran', name: 'Iran / Persian Gulf', color: '#ef4444' },
    { id: 'ukraine-russia', name: 'Ukraine-Russia', color: '#fbbf24' },
    { id: 'indo-pacific', name: 'Indo-Pacific', color: '#3b82f6' },
    { id: 'sudan', name: 'Sudan', color: '#f97316' },
    { id: 'sahel', name: 'Sahel', color: '#a855f7' },
    { id: 'myanmar', name: 'Myanmar', color: '#22c55e' },
    { id: 'korea', name: 'Korean Peninsula', color: '#06b6d4' },
    { id: 'arctic', name: 'Arctic', color: '#38bdf8' },
  ];

  const activeTheaters = new Set(THEATERS.map(t => t.id));

  async function init(viewer) {
    try {
      const results = await Promise.all(
        THEATERS.map(t =>
          fetch(`data/theaters/${t.id}.json`)
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
        )
      );
      eventData = results.flat();
      renderEvents(viewer);
      updateStats();
      Globe.requestRender();
      console.log(`[Conflicts] ${eventData.length} events across ${THEATERS.length} theaters`);
    } catch (err) {
      console.warn('[Conflicts] Failed to load:', err.message);
    }
  }

  function renderEvents(viewer) {
    entities.forEach(e => viewer.entities.remove(e));
    entities = [];

    eventData.forEach(evt => {
      const color = TYPE_COLORS[evt.type] || '#ef4444';

      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(evt.lon, evt.lat),
        billboard: {
          image: createEventIcon(evt.type, color),
          width: 22,
          height: 22,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: 0,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: evt.name,
          font: '10px monospace',
          fillColor: Cesium.Color.fromCssColorString(color).withAlpha(0.8),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 14),
          disableDepthTestDistance: 0,
          show: true,
          scaleByDistance: new Cesium.NearFarScalar(1e5, 1, 5e6, 0.4),
        },
        properties: {
          type: 'conflict',
          id: evt.id,
          name: evt.name,
          lat: evt.lat,
          lon: evt.lon,
          eventType: evt.type,
          theater: evt.theater,
          date: evt.date,
          operation: evt.operation,
          parties: (evt.parties || []).join(', '),
          target: evt.target,
          casualties: evt.casualties,
          description: evt.description,
          eventSources: (evt.sources || []).join('; '),
          eventColor: color,
          photoUrl: evt.photo_url,
        },
        show: visible && activeTheaters.has(evt.theater),
      });

      entities.push(entity);
    });
  }

  function createEventIcon(type, color) {
    const key = type + color;
    if (iconCache[key]) return iconCache[key];

    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d');
    const cx = 12, cy = 12;

    switch (type) {
      case 'airstrike':
      case 'nuclear':
        drawBurst(ctx, cx, cy, 10, 5, 8, color);
        break;
      case 'missile':
        drawBurst(ctx, cx, cy, 10, 5, 6, color);
        break;
      case 'retaliation':
        drawCrosshair(ctx, cx, cy, 9, color);
        break;
      case 'naval':
        drawAnchor(ctx, cx, cy, 9, color);
        break;
      case 'blockade':
        drawBlockade(ctx, cx, cy, 9, color);
        break;
      case 'cyber':
        drawLightning(ctx, cx, cy, 10, color);
        break;
      case 'ground':
        drawChevron(ctx, cx, cy, 9, color);
        break;
      case 'political':
        drawPolitical(ctx, cx, cy, 9, color);
        break;
      case 'economic':
        drawEconomic(ctx, cx, cy, 9, color);
        break;
      default:
        drawBurst(ctx, cx, cy, 10, 5, 8, color);
    }

    const dataUrl = canvas.toDataURL();
    iconCache[key] = dataUrl;
    return dataUrl;
  }

  function drawBurst(ctx, cx, cy, outerR, innerR, points, color) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = color + '66';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawCrosshair(ctx, cx, cy, r, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = color + '44';
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - r - 2); ctx.lineTo(cx, cy - r * 0.5);
    ctx.moveTo(cx, cy + r * 0.5); ctx.lineTo(cx, cy + r + 2);
    ctx.moveTo(cx - r - 2, cy); ctx.lineTo(cx - r * 0.5, cy);
    ctx.moveTo(cx + r * 0.5, cy); ctx.lineTo(cx + r + 2, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawAnchor(ctx, cx, cy, r, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.fillStyle = color + '44';
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.4, r * 0.25, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.15);
    ctx.lineTo(cx, cy + r * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.5, cy - r * 0.15);
    ctx.lineTo(cx + r * 0.5, cy - r * 0.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.7, r * 0.5, Math.PI, 0);
    ctx.stroke();
  }

  function drawBlockade(ctx, cx, cy, r, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.fillStyle = color + '33';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.7, cy + r * 0.7);
    ctx.lineTo(cx + r * 0.7, cy - r * 0.7);
    ctx.stroke();
  }

  function drawLightning(ctx, cx, cy, r, color) {
    ctx.fillStyle = color + '88';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + 1, cy - r);
    ctx.lineTo(cx - 4, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx - 1, cy + r);
    ctx.lineTo(cx + 4, cy);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawChevron(ctx, cx, cy, r, color) {
    ctx.fillStyle = color + '55';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy + r * 0.3);
    ctx.lineTo(cx + r * 0.5, cy + r * 0.3);
    ctx.lineTo(cx + r * 0.5, cy + r);
    ctx.lineTo(cx - r * 0.5, cy + r);
    ctx.lineTo(cx - r * 0.5, cy + r * 0.3);
    ctx.lineTo(cx - r, cy + r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawPolitical(ctx, cx, cy, r, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.fillStyle = color + '44';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = (i * Math.PI) / 5 - Math.PI / 2;
      const sr = i % 2 === 0 ? r * 0.55 : r * 0.22;
      const x = cx + sr * Math.cos(angle);
      const y = cy + sr * Math.sin(angle);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawEconomic(ctx, cx, cy, r, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.fillStyle = color + '44';
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.4);
    ctx.lineTo(cx, cy - r * 0.4);
    ctx.moveTo(cx - r * 0.25, cy - r * 0.15);
    ctx.lineTo(cx, cy - r * 0.4);
    ctx.lineTo(cx + r * 0.25, cy - r * 0.15);
    ctx.stroke();
  }

  function getEventById(id) {
    return eventData.find(e => e.id === id);
  }

  function setVisible(v) {
    visible = v;
    entities.forEach((e, i) => {
      const evt = eventData[i];
      e.show = v && activeTheaters.has(evt.theater);
    });
    Globe.requestRender();
  }

  function isVisible() { return visible; }

  function getCount() {
    return eventData.filter(e => activeTheaters.has(e.theater)).length;
  }

  function updateStats() {
    const el = document.getElementById('stat-conflicts');
    if (el) el.textContent = `${getCount()} events`;
  }

  function setLabelsVisible(show) {
    entities.forEach(e => {
      if (e.label) e.label.show = show;
    });
  }

  function setTime(epoch) {
    if (!epoch) {
      entities.forEach((e, i) => {
        const evt = eventData[i];
        e.show = visible && activeTheaters.has(evt.theater);
      });
    } else {
      entities.forEach((e, i) => {
        const evt = eventData[i];
        if (!evt || !evt.date) {
          e.show = visible && activeTheaters.has(evt.theater);
          return;
        }
        const evtTime = new Date(evt.date).getTime();
        e.show = visible && activeTheaters.has(evt.theater) && evtTime <= epoch;
      });
    }
    Globe.requestRender();
  }

  function applyTheaterFilter() {
    entities.forEach((e, i) => {
      const evt = eventData[i];
      e.show = visible && activeTheaters.has(evt.theater);
    });
    updateStats();
    Globe.requestRender();
  }

  function getTheaters() { return THEATERS; }
  function isTheaterActive(id) { return activeTheaters.has(id); }

  function toggleTheater(id) {
    if (activeTheaters.has(id)) {
      activeTheaters.delete(id);
    } else {
      activeTheaters.add(id);
    }
    applyTheaterFilter();
  }

  function setAllTheaters(active) {
    if (active) {
      THEATERS.forEach(t => activeTheaters.add(t.id));
    } else {
      activeTheaters.clear();
    }
    applyTheaterFilter();
  }

  function getTheaterMask() {
    return THEATERS.map(t => activeTheaters.has(t.id) ? '1' : '0').join('');
  }

  function applyTheaterMask(mask) {
    if (!mask || mask.length !== THEATERS.length) return;
    THEATERS.forEach((t, i) => {
      if (mask[i] === '1') {
        activeTheaters.add(t.id);
      } else {
        activeTheaters.delete(t.id);
      }
    });
    applyTheaterFilter();
  }

  return {
    init, setVisible, isVisible, getCount, getEventById, setLabelsVisible, setTime,
    getTheaters, isTheaterActive, toggleTheater, setAllTheaters,
    getTheaterMask, applyTheaterMask,
  };
})();
