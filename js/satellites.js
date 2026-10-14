// satellites.js — CelesTrak TLE data + satellite.js propagation

const Satellites = (() => {
  let entities = [];
  let satRecords = []; // parsed satellite.js records
  let visible = true;
  let trackedSatId = null;
  let orbitEntity = null;
  let consecutiveFailures = 0;
  let timeOverride = null; // null = LIVE, epoch ms = override
  const MAX_SATS = 500; // limit for performance
  const MAX_FAILURES = 2;

  // CelesTrak TLE text format (3-line: name, line1, line2)
  const TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=ACTIVE&FORMAT=TLE';
  const REFRESH_MS = 7200000; // 2 hours

  async function init(viewer) {
    await fetchTLEs(viewer);
    // Only start position updates if we got data
    if (satRecords.length > 0) {
      setInterval(() => updatePositions(viewer), 3000);
      setInterval(() => fetchTLEs(viewer), REFRESH_MS);
    } else {
      console.warn('[Satellites] No data loaded — skipping position updates');
    }
  }

  async function fetchTLEs(viewer) {
    try {
      // Try direct first, fall back to proxy
      let resp;
      try {
        resp = await fetch(TLE_URL);
        if (!resp.ok) throw new Error('Direct fetch failed');
      } catch {
        resp = await fetch(`/.netlify/functions/proxy?url=${encodeURIComponent(TLE_URL)}`);
        if (!resp.ok) throw new Error(`proxy ${resp.status}`);
      }

      const text = await resp.text();
      // CelesTrak answers rate-limited requests with a plain-text notice; parsing
      // that would wipe the satellites already on the globe.
      if (!/^1 \d/m.test(text)) throw new Error('no TLE data in response');
      parseTLEs(text);
      renderSats(viewer);
      updateStats();
      consecutiveFailures = 0;
      console.log(`[Satellites] Loaded ${satRecords.length} satellites`);
    } catch (err) {
      consecutiveFailures++;
      console.warn(`[Satellites] Fetch failed (${consecutiveFailures}/${MAX_FAILURES}):`, err.message);
    }
  }

  function parseTLEs(tleText) {
    satRecords = [];
    const lines = tleText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    for (let i = 0; i + 2 < lines.length && satRecords.length < MAX_SATS; i += 3) {
      try {
        const name = lines[i];
        const line1 = lines[i + 1];
        const line2 = lines[i + 2];
        if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue;

        const satrec = satellite.twoline2satrec(line1, line2);
        // Extract orbital params from satrec
        const meanMotion = satrec.no * 1440 / (2 * Math.PI); // rad/min to rev/day
        const period = 1440 / meanMotion; // minutes
        const incDeg = satrec.inclo * (180 / Math.PI);
        const ecc = satrec.ecco;
        const a = Math.pow(8681663.653 / meanMotion, 2 / 3); // semi-major axis in km
        const apogee = a * (1 + ecc) - 6371;
        const perigee = a * (1 - ecc) - 6371;

        satRecords.push({
          satrec,
          name: name,
          noradId: satrec.satnum,
          objectType: 'PAYLOAD',
          period: period.toFixed(1),
          inclination: incDeg.toFixed(1),
          apogee: apogee.toFixed(0),
          perigee: perigee.toFixed(0),
        });
      } catch {
        // Skip unparseable entries
      }
    }
  }

  function getPosition(satrec, date) {
    const posVel = satellite.propagate(satrec, date);
    if (!posVel.position) return null;
    const gmst = satellite.gstime(date);
    const geo = satellite.eciToGeodetic(posVel.position, gmst);
    return {
      lat: satellite.degreesLat(geo.latitude),
      lon: satellite.degreesLong(geo.longitude),
      alt: geo.height * 1000, // km to m
    };
  }

  function renderSats(viewer) {
    // Remove old
    entities.forEach(e => viewer.entities.remove(e));
    if (orbitEntity) { viewer.entities.remove(orbitEntity); orbitEntity = null; }
    entities = [];

    const now = new Date();

    satRecords.forEach(sat => {
      const pos = getPosition(sat.satrec, now);
      if (!pos) return;

      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt),
        point: {
          pixelSize: 3,
          color: Cesium.Color.fromCssColorString('#60a5fa').withAlpha(0.8),
          disableDepthTestDistance: 0,
        },
        label: {
          text: sat.name,
          font: '9px monospace',
          fillColor: Cesium.Color.fromCssColorString('#60a5fa').withAlpha(0.6),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -6),
          disableDepthTestDistance: 0,
          show: false, // hidden by default, toggle with L
          scaleByDistance: new Cesium.NearFarScalar(1e6, 1, 5e6, 0.4),
        },
        properties: {
          type: 'satellite',
          name: sat.name,
          noradId: sat.noradId,
          objectType: sat.objectType,
          period: sat.period,
          inclination: sat.inclination,
          apogee: sat.apogee,
          perigee: sat.perigee,
          satIndex: satRecords.indexOf(sat),
        },
        show: visible,
      });

      entities.push(entity);
    });
  }

  function updatePositions(viewer) {
    if (!visible) return;
    const now = timeOverride !== null ? new Date(timeOverride) : new Date();

    entities.forEach((entity, i) => {
      if (i >= satRecords.length) return;
      const sat = satRecords[i];
      const pos = getPosition(sat.satrec, now);
      if (pos) {
        entity.position = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt);
      }
    });

    // Update orbit line if tracking
    if (trackedSatId !== null) {
      drawOrbit(viewer, trackedSatId);
    }

    Globe.requestRender();
  }

  function trackSat(viewer, satIndex) {
    trackedSatId = satIndex;
    drawOrbit(viewer, satIndex);
  }

  function drawOrbit(viewer, satIndex) {
    if (orbitEntity) viewer.entities.remove(orbitEntity);
    if (satIndex === null || satIndex >= satRecords.length) return;

    const sat = satRecords[satIndex];
    const positions = [];
    const now = new Date();
    const periodMin = sat.period || 90;
    const steps = 120;

    for (let i = 0; i <= steps; i++) {
      const t = new Date(now.getTime() + (i / steps) * periodMin * 60000);
      const pos = getPosition(sat.satrec, t);
      if (pos) {
        positions.push(Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt));
      }
    }

    if (positions.length > 2) {
      orbitEntity = viewer.entities.add({
        polyline: {
          positions: positions,
          width: 1,
          material: Cesium.Color.fromCssColorString('#60a5fa').withAlpha(0.4),
        },
        show: visible,
      });
    }
  }

  function setVisible(v) {
    visible = v;
    entities.forEach(e => { e.show = v; });
    if (orbitEntity) orbitEntity.show = v;
    Globe.requestRender();
  }

  function isVisible() { return visible; }
  function getCount() { return entities.length; }

  function updateStats() {
    const el = document.getElementById('stat-sats');
    if (el) el.textContent = `${entities.length} sats`;
  }

  function setLabelsVisible(show) {
    entities.forEach(e => {
      if (e.label) e.label.show = show;
    });
  }

  function setTime(epochMs) {
    timeOverride = epochMs;
    // Immediately reposition satellites to the new time
    const v = Globe.getViewer();
    if (v && entities.length > 0) {
      updatePositions(v);
    }
  }

  return { init, setVisible, isVisible, getCount, trackSat, setLabelsVisible, setTime };
})();
