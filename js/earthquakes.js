// earthquakes.js — USGS GeoJSON earthquake feed with pulsing markers

const Earthquakes = (() => {
  let entities = [];
  let labelsVisible = true; // survives the poll rebuild
  let visible = true;
  let quakeData = [];
  const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson';
  const REFRESH_MS = 60000; // 1 minute
  let timeFilter = null; // null = LIVE (show all), epoch ms = filter

  async function init(viewer) {
    await fetchQuakes(viewer);
    setInterval(() => fetchQuakes(viewer), REFRESH_MS);
  }

  async function fetchQuakes(viewer) {
    try {
      const resp = await fetch(FEED_URL);
      const data = await resp.json();
      quakeData = data.features || [];
      renderQuakes(viewer);
      updateStats();
      Globe.requestRender();
    } catch (err) {
      console.warn('[Earthquakes] Fetch failed:', err.message);
    }
  }

  function renderQuakes(viewer) {
    // Remove old entities
    entities.forEach(e => viewer.entities.remove(e));
    entities = [];

    quakeData.forEach(feature => {
      const coords = feature.geometry.coordinates;
      const props = feature.properties;
      const mag = props.mag || 1;
      const depth = coords[2] || 0;
      const lon = coords[0];
      const lat = coords[1];

      // Size based on magnitude (exponential scaling)
      const size = Math.max(4, Math.pow(mag, 1.8) * 2);

      // Color based on depth
      let color;
      if (depth < 20) color = Cesium.Color.fromCssColorString('#fbbf24'); // shallow = yellow
      else if (depth < 70) color = Cesium.Color.fromCssColorString('#fb923c'); // medium = orange
      else color = Cesium.Color.fromCssColorString('#f87171'); // deep = red

      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        point: {
          pixelSize: size,
          color: color.withAlpha(0.7),
          outlineColor: color,
          outlineWidth: 1,
          disableDepthTestDistance: 0,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: `M${mag.toFixed(1)}`,
          font: '10px monospace',
          fillColor: Cesium.Color.WHITE.withAlpha(0.8),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -size - 4),
          disableDepthTestDistance: 0,
          show: labelsVisible,
        },
        properties: {
          type: 'earthquake',
          magnitude: mag,
          depth: depth,
          place: props.place || 'Unknown',
          time: props.time,
          url: props.url,
          id: feature.id,
        },
        show: visible,
      });

      entities.push(entity);
    });
  }

  function setVisible(v) {
    visible = v;
    if (timeFilter !== null) {
      applyTimeFilter();
    } else {
      entities.forEach(e => { e.show = v; });
    }
    Globe.requestRender();
  }

  function isVisible() { return visible; }

  function getData() { return quakeData; }
  function getEntities() { return entities; }

  function getCount() { return entities.length; }

  function updateStats() {
    const el = document.getElementById('stat-quakes');
    if (el) el.textContent = `${entities.length} quakes`;
  }

  // Get earthquakes within radius (km) of a lat/lon
  function getNearby(lat, lon, radiusKm) {
    return quakeData.filter(f => {
      const qlat = f.geometry.coordinates[1];
      const qlon = f.geometry.coordinates[0];
      const dist = haversine(lat, lon, qlat, qlon);
      return dist <= radiusKm;
    }).map(f => ({
      ...f,
      distance: haversine(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0]),
    })).sort((a, b) => a.distance - b.distance);
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function setLabelsVisible(show) {
    labelsVisible = show;
    entities.forEach(e => {
      if (e.label) e.label.show = show;
    });
  }

  function setTime(epochMs) {
    timeFilter = epochMs;
    applyTimeFilter();
    Globe.requestRender();
  }

  function applyTimeFilter() {
    entities.forEach((entity, i) => {
      if (i >= quakeData.length) return;
      const quakeTime = quakeData[i].properties.time;
      if (timeFilter === null) {
        // LIVE — show all, full alpha
        entity.show = visible;
        if (entity.point) {
          const origAlpha = 0.7;
          entity.point.color = entity.point.color.getValue().withAlpha(origAlpha);
        }
      } else {
        // REPLAY — only show quakes before current time
        const shouldShow = quakeTime <= timeFilter;
        entity.show = visible && shouldShow;
        if (shouldShow && entity.point) {
          // Recent quakes (within 1h of scrub time) full alpha, older ones dim
          const age = timeFilter - quakeTime;
          const alpha = age < 3600000 ? 0.8 : 0.35;
          entity.point.color = entity.point.color.getValue().withAlpha(alpha);
        }
      }
    });
  }

  return { init, setVisible, isVisible, getData, getEntities, getCount, getNearby, setLabelsVisible, setTime };
})();
