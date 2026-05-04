// aircraft.js — Military aircraft tracking via adsb.lol
// Only renders military aircraft (~100-300 globally). No civilian traffic.

const Aircraft = (() => {
  let pointCollection = null;
  let labelCollection = null;
  const pointMap = new Map();  // hex → PointPrimitive
  const labelMap = new Map();  // hex → Label

  let visible = true;
  let labelsVisible = true;
  let aircraftData = [];
  let trackedHex = null;
  let trailEntity = null;
  let trailPositions = [];
  let consecutiveFailures = 0;
  let refreshTimer = null;
  let fetchInFlight = false;

  // Cached Cesium objects
  const MIL_COLOR = Cesium.Color.fromCssColorString('#fb923c').withAlpha(0.85);
  const MIL_OUTLINE = Cesium.Color.fromCssColorString('#fb923c');
  const MIL_LABEL_COLOR = Cesium.Color.fromCssColorString('#fb923c').withAlpha(0.7);
  const LABEL_OFFSET = new Cesium.Cartesian2(0, -8);
  const LABEL_SCALE = new Cesium.NearFarScalar(1e5, 1, 5e6, 0.3);
  const POINT_SCALE = new Cesium.NearFarScalar(1e5, 1.0, 8e6, 0.4);
  const TRAIL_COLOR = Cesium.Color.fromCssColorString('#fb923c').withAlpha(0.5);

  const MIL_URL = '/.netlify/functions/proxy?url=' + encodeURIComponent('https://api.adsb.lol/v2/mil');
  const REFRESH_MS = 15000;
  const FETCH_TIMEOUT_MS = 12000;
  const MAX_FAILURES = 5;

  async function init(viewer) {
    pointCollection = viewer.scene.primitives.add(
      new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT })
    );
    labelCollection = viewer.scene.primitives.add(new Cesium.LabelCollection());

    await fetchAircraft(viewer);
    if (consecutiveFailures < MAX_FAILURES) {
      refreshTimer = setInterval(() => {
        if (consecutiveFailures >= MAX_FAILURES) {
          clearInterval(refreshTimer);
          console.warn('[Aircraft] Disabled auto-refresh after repeated failures');
          return;
        }
        fetchAircraft(viewer);
      }, REFRESH_MS);
    }
  }

  async function fetchAircraft(viewer) {
    if (fetchInFlight) return;
    fetchInFlight = true;
    try {
      const data = await fetchWithProxy(MIL_URL);
      const ac = (data.ac || []).filter(a => a.hex && a.lat != null && a.lon != null);

      aircraftData = ac.map(a => ({
        hex: a.hex,
        flight: (a.flight || '').trim(),
        lat: a.lat,
        lon: a.lon,
        alt_meters: (a.alt_geom || a.alt_baro || 10000) * 0.3048,
        track: a.track || 0,
        gs: a.gs,
        squawk: a.squawk,
        category: a.category,
        r: a.r,
        t: a.t,
        ownOp: a.ownOp,
        dbFlags: a.dbFlags,
      }));

      console.log(`[Aircraft] ${aircraftData.length} military aircraft`);
      consecutiveFailures = 0;
      reconcileRender(viewer);
      updateStats();
      Globe.requestRender();
    } catch (err) {
      consecutiveFailures++;
      console.warn(`[Aircraft] Fetch failed (${consecutiveFailures}/${MAX_FAILURES}):`, err.message);
      updateStats();
    } finally {
      fetchInFlight = false;
    }
  }

  async function fetchWithProxy(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Fetch timeout');
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Delta reconciliation — update in place, add new, remove departed
  function reconcileRender(viewer) {
    const desired = new Map(aircraftData.map(ac => [ac.hex, ac]));

    // Update existing / remove departed
    for (const [hex, point] of pointMap) {
      const ac = desired.get(hex);
      if (ac) {
        const pos = Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, ac.alt_meters || 0);
        point.position = pos;
        point.id = makePickData(ac);
        const label = labelMap.get(hex);
        if (label) {
          label.position = pos;
          label.text = ac.flight || ac.hex || '-';
          label.id = point.id;
        }
        desired.delete(hex);
      } else {
        pointCollection.remove(point);
        pointMap.delete(hex);
        const label = labelMap.get(hex);
        if (label) {
          labelCollection.remove(label);
          labelMap.delete(hex);
        }
      }
    }

    // Add new
    for (const [hex, ac] of desired) {
      const pos = Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, ac.alt_meters || 0);
      const pickData = makePickData(ac);

      const point = pointCollection.add({
        position: pos,
        pixelSize: 5,
        color: MIL_COLOR,
        outlineColor: MIL_OUTLINE,
        outlineWidth: 1,
        disableDepthTestDistance: 0,
        scaleByDistance: POINT_SCALE,
        id: pickData,
        show: visible,
      });
      pointMap.set(hex, point);

      const label = labelCollection.add({
        position: pos,
        text: ac.flight || ac.hex || '-',
        font: '10px monospace',
        fillColor: MIL_LABEL_COLOR,
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
      labelMap.set(hex, label);
    }

    // Update trail
    if (trackedHex) {
      const tracked = aircraftData.find(a => a.hex === trackedHex);
      if (tracked && tracked.lat && tracked.lon) {
        trailPositions.push(Cesium.Cartesian3.fromDegrees(tracked.lon, tracked.lat, tracked.alt_meters || 0));
        if (trailPositions.length > 100) trailPositions.shift();
        drawTrail(viewer);
      }
    }
  }

  function makePickData(ac) {
    return {
      type: 'aircraft',
      hex: ac.hex,
      callsign: ac.flight || ac.hex || '',
      isMilitary: true,
      altitude: ac.alt_meters || 0,
      speed: ac.gs,
      heading: ac.track || 0,
      squawk: ac.squawk,
      category: ac.category,
      registration: ac.r || null,
      aircraftType: ac.t || null,
      operator: ac.ownOp || null,
      originCountry: null,
    };
  }

  function trackAircraft(viewer, hex) {
    trackedHex = hex;
    trailPositions = [];
    const ac = aircraftData.find(a => a.hex === hex);
    if (ac && ac.lat && ac.lon) {
      trailPositions.push(Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, ac.alt_meters || 0));
    }
  }

  function drawTrail(viewer) {
    if (trailEntity) viewer.entities.remove(trailEntity);
    if (trailPositions.length < 2) return;
    trailEntity = viewer.entities.add({
      polyline: {
        positions: [...trailPositions],
        width: 1.5,
        material: TRAIL_COLOR,
      },
      show: visible,
    });
  }

  function clearTrack(viewer) {
    trackedHex = null;
    trailPositions = [];
    if (trailEntity) { viewer.entities.remove(trailEntity); trailEntity = null; }
  }

  function setVisible(v) {
    visible = v;
    if (pointCollection) pointCollection.show = v;
    if (labelCollection) labelCollection.show = v && labelsVisible;
    if (trailEntity) trailEntity.show = v;
    Globe.requestRender();
  }

  function isVisible() { return visible; }

  function setLabelsVisible(show) {
    labelsVisible = show;
    if (labelCollection) labelCollection.show = visible && show;
  }

  function getCount() { return pointMap.size; }
  function getMilCount() { return aircraftData.length; }

  function updateStats() {
    const el = document.getElementById('stat-aircraft');
    if (!el) return;
    if (consecutiveFailures >= MAX_FAILURES) {
      el.textContent = `feed offline — ${aircraftData.length} cached`;
      el.title = 'Aircraft data feed is unreachable. Auto-refresh disabled after repeated failures.';
      el.dataset.degraded = 'disabled';
    } else if (consecutiveFailures > 0) {
      el.textContent = `${aircraftData.length} military aircraft (stale)`;
      el.title = `Last ${consecutiveFailures} refresh${consecutiveFailures === 1 ? '' : 'es'} failed — showing last known positions.`;
      el.dataset.degraded = 'stale';
    } else {
      el.textContent = `${aircraftData.length} military aircraft`;
      el.removeAttribute('title');
      delete el.dataset.degraded;
    }
  }

  return {
    init, setVisible, isVisible, getCount, getMilCount,
    trackAircraft, clearTrack, setLabelsVisible,
  };
})();
