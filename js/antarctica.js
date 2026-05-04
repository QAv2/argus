// antarctica.js — Antarctic Intelligence Layer (A key)
// Research stations, territorial claims, treaty boundary, historic sites,
// military operations, disclosure anomalies, protected areas, geographic features

const Antarctica = (() => {
  let viewer = null;
  let visible = false;
  let dataSource = null;
  let entities = [];
  let allData = null;
  const iconCache = {};

  // Country colors for station markers
  const COUNTRY_COLORS = {
    'United States': '#3b82f6',
    'Russia': '#ef4444',
    'China': '#eab308',
    'United Kingdom': '#a78bfa',
    'Argentina': '#60a5fa',
    'Chile': '#fb7185',
    'Australia': '#f59e0b',
    'France': '#818cf8',
    'France/Italy': '#818cf8',
    'Italy': '#34d399',
    'Japan': '#f472b6',
    'Germany': '#9ca3af',
    'South Korea': '#2dd4bf',
    'India': '#fb923c',
    'New Zealand': '#4ade80',
    'Norway': '#22d3ee',
    'South Africa': '#a3e635',
    'Belgium': '#fbbf24',
    'Poland': '#f87171',
    'Ukraine': '#facc15',
    'Brazil': '#4ade80',
    'Spain': '#f59e0b',
    'Uruguay': '#93c5fd',
    'Czech Republic': '#60a5fa',
    'Ecuador': '#fbbf24',
    'Peru': '#f87171',
    'Bulgaria': '#4ade80',
    'Turkey': '#f87171',
    'Finland': '#93c5fd',
    'Sweden': '#fde047',
    'Romania': '#60a5fa',
    'Pakistan': '#4ade80',
    'Belarus': '#f87171',
    'Netherlands': '#fb923c',
  };

  // Territorial claim colors
  const CLAIM_COLORS = {
    'United Kingdom': '#a78bfa',
    'Argentina': '#60a5fa',
    'Chile': '#fb7185',
    'Norway': '#22d3ee',
    'Australia': '#f59e0b',
    'France': '#818cf8',
    'New Zealand': '#4ade80',
    'None': '#6b7280',
  };

  function getCountryColor(country) {
    return COUNTRY_COLORS[country] || '#94a3b8';
  }

  function getClaimColor(country) {
    return CLAIM_COLORS[country] || '#6b7280';
  }

  // ── Canvas Icon Generators ────────────────────────────────────────

  function createStationIcon(color, isYearRound) {
    const key = 'stn-' + color + (isYearRound ? '-yr' : '-s');
    if (iconCache[key]) return iconCache[key];

    const s = 20;
    const canvas = document.createElement('canvas');
    canvas.width = s; canvas.height = s;
    const ctx = canvas.getContext('2d');
    const cx = s / 2, cy = s / 2;

    if (isYearRound) {
      // Filled diamond for year-round stations
      const r = 6;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fillStyle = color + 'cc';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      // Open circle for seasonal stations
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }

    const url = canvas.toDataURL();
    iconCache[key] = url;
    return url;
  }

  function createHistoricIcon(color) {
    const key = 'hist-' + color;
    if (iconCache[key]) return iconCache[key];

    const s = 20;
    const canvas = document.createElement('canvas');
    canvas.width = s; canvas.height = s;
    const ctx = canvas.getContext('2d');
    const cx = s / 2, cy = s / 2;

    // 5-pointed star
    const spikes = 5, outerR = 7, innerR = 3;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const angle = (i * Math.PI) / spikes - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      const px = cx + r * Math.cos(angle);
      const py = cy + r * Math.sin(angle);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color + '99';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    const url = canvas.toDataURL();
    iconCache[key] = url;
    return url;
  }

  function createDisclosureIcon(color) {
    const key = 'disc-' + color;
    if (iconCache[key]) return iconCache[key];

    const s = 22;
    const canvas = document.createElement('canvas');
    canvas.width = s; canvas.height = s;
    const ctx = canvas.getContext('2d');
    const cx = s / 2, cy = s / 2;

    // Triangle with inner dot
    const r = 8;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.87, cy + r * 0.5);
    ctx.lineTo(cx - r * 0.87, cy + r * 0.5);
    ctx.closePath();
    ctx.fillStyle = color + '44';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy + 1, 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    const url = canvas.toDataURL();
    iconCache[key] = url;
    return url;
  }

  function createMilitaryIcon(color) {
    const key = 'mil-' + color;
    if (iconCache[key]) return iconCache[key];

    const s = 20;
    const canvas = document.createElement('canvas');
    canvas.width = s; canvas.height = s;
    const ctx = canvas.getContext('2d');
    const cx = s / 2, cy = s / 2;

    // Cross/plus shape
    const w = 3, r = 6;
    ctx.beginPath();
    ctx.moveTo(cx - w, cy - r); ctx.lineTo(cx + w, cy - r);
    ctx.lineTo(cx + w, cy - w); ctx.lineTo(cx + r, cy - w);
    ctx.lineTo(cx + r, cy + w); ctx.lineTo(cx + w, cy + w);
    ctx.lineTo(cx + w, cy + r); ctx.lineTo(cx - w, cy + r);
    ctx.lineTo(cx - w, cy + w); ctx.lineTo(cx - r, cy + w);
    ctx.lineTo(cx - r, cy - w); ctx.lineTo(cx - w, cy - w);
    ctx.closePath();
    ctx.fillStyle = color + '88';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    const url = canvas.toDataURL();
    iconCache[key] = url;
    return url;
  }

  function createFeatureIcon(color) {
    const key = 'feat-' + color;
    if (iconCache[key]) return iconCache[key];

    const s = 16;
    const canvas = document.createElement('canvas');
    canvas.width = s; canvas.height = s;
    const ctx = canvas.getContext('2d');
    const cx = s / 2, cy = s / 2;

    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = color + '88';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    const url = canvas.toDataURL();
    iconCache[key] = url;
    return url;
  }

  // ── Mid-Longitude for Antimeridian Crossing ───────────────────────

  function midLon(west, east) {
    if (east >= west) return (west + east) / 2;
    let mid = (west + east + 360) / 2;
    if (mid > 180) mid -= 360;
    return mid;
  }

  // ── Data Loading ──────────────────────────────────────────────────

  async function init(v) {
    viewer = v;
    dataSource = new Cesium.CustomDataSource('antarctica');
    viewer.dataSources.add(dataSource);
    dataSource.show = false;

    try {
      const resp = await fetch('data/antarctica.json');
      allData = await resp.json();
      renderAll();
      updateStats();
      Globe.requestRender();
    } catch (err) {
      console.warn('[Antarctica] Failed to load:', err.message);
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────

  function renderAll() {
    if (!allData) return;
    dataSource.entities.removeAll();
    entities = [];

    renderBoundary();
    renderClaims();
    renderStations();
    renderProtectedAreas();
    renderHistoricSites();
    renderMilitaryOps();
    renderDisclosureSites();
    renderGeographicFeatures();
  }

  function renderBoundary() {
    // 60deg S Antarctic Treaty boundary — dashed polyline circle
    const positions = [];
    for (let lon = -180; lon <= 180; lon += 1) {
      positions.push(Cesium.Cartesian3.fromDegrees(lon, -60));
    }

    const entity = dataSource.entities.add({
      polyline: {
        positions: positions,
        width: 2,
        material: new Cesium.PolylineDashMaterialProperty({
          color: Cesium.Color.fromCssColorString('#38bdf8').withAlpha(0.5),
          dashLength: 16,
        }),
        clampToGround: true,
      },
      properties: {
        type: 'antarctica',
        subType: 'boundary',
        name: '60\u00b0S Antarctic Treaty Boundary',
      },
    });
    entities.push(entity);
  }

  function renderClaims() {
    if (!allData.territorial_claims) return;

    allData.territorial_claims.forEach(claim => {
      const color = getClaimColor(claim.country);

      // Point claims (e.g. Peter I Island) — render as marker, not wedge
      if (claim.lat != null && claim.lon != null && claim.lon_west == null) {
        const entity = dataSource.entities.add({
          position: Cesium.Cartesian3.fromDegrees(claim.lon, claim.lat),
          point: {
            pixelSize: 8,
            color: Cesium.Color.fromCssColorString(color).withAlpha(0.6),
            outlineColor: Cesium.Color.fromCssColorString(color),
            outlineWidth: 1,
            disableDepthTestDistance: 0,
          },
          label: {
            text: claim.name,
            font: '9px monospace',
            fillColor: Cesium.Color.fromCssColorString(color).withAlpha(0.7),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(0, 10),
            disableDepthTestDistance: 0,
            scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 3e6, 0.4),
            show: true,
          },
          properties: {
            type: 'antarctica',
            subType: 'claim',
            name: claim.name,
            country: claim.country,
            yearClaimed: claim.year_claimed,
            notes: claim.notes,
          },
        });
        entities.push(entity);
        return;
      }

      // Sector claims — render as wedge polygon
      if (claim.lon_west == null || claim.lon_east == null) return;

      const positions = [];

      // Use -88 for pole vertex (CesiumJS outline geometry breaks near exact pole)
      positions.push(Cesium.Cartesian3.fromDegrees(claim.lon_west, -88));

      // Arc along 60deg S boundary
      let lonStart = claim.lon_west;
      let lonEnd = claim.lon_east;
      if (lonEnd < lonStart) lonEnd += 360; // Handle antimeridian crossing

      for (let lon = lonStart; lon <= lonEnd; lon += 2) {
        let nLon = lon > 180 ? lon - 360 : lon;
        positions.push(Cesium.Cartesian3.fromDegrees(nLon, -60));
      }
      // Ensure exact endpoint
      positions.push(Cesium.Cartesian3.fromDegrees(claim.lon_east, -60));

      // Back to pole
      positions.push(Cesium.Cartesian3.fromDegrees(claim.lon_east, -88));

      const entity = dataSource.entities.add({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: Cesium.Color.fromCssColorString(color).withAlpha(0.08),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(color).withAlpha(0.35),
          outlineWidth: 1,
          height: 0,
        },
        properties: {
          type: 'antarctica',
          subType: 'claim',
          name: claim.name,
          country: claim.country,
          yearClaimed: claim.year_claimed,
          notes: claim.notes,
        },
      });
      entities.push(entity);

      // Claim label at ~72deg S
      const labelLon = midLon(claim.lon_west, claim.lon_east);
      const labelEntity = dataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(labelLon, -72),
        label: {
          text: claim.name,
          font: '9px monospace',
          fillColor: Cesium.Color.fromCssColorString(color).withAlpha(0.6),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(5e5, 1, 1e7, 0.5),
          show: true,
        },
        properties: {
          type: 'antarctica',
          subType: 'claim',
          name: claim.name,
          country: claim.country,
          yearClaimed: claim.year_claimed,
          notes: claim.notes,
        },
      });
      entities.push(labelEntity);
    });
  }

  function renderStations() {
    if (!allData.research_stations) return;

    allData.research_stations.forEach(stn => {
      const color = getCountryColor(stn.country);
      const isYearRound = stn.seasonality === 'Year-Round';

      const entity = dataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(stn.lon, stn.lat),
        billboard: {
          image: createStationIcon(color, isYearRound),
          width: 18,
          height: 18,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1.2, 5e6, 0.5),
        },
        label: {
          text: stn.name,
          font: '10px monospace',
          fillColor: Cesium.Color.fromCssColorString(color).withAlpha(0.85),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 12),
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 3e6, 0.3),
          show: true,
        },
        properties: {
          type: 'antarctica',
          subType: 'station',
          name: stn.name,
          officialName: stn.official_name,
          country: stn.country,
          lat: stn.lat,
          lon: stn.lon,
          year: stn.year,
          seasonality: stn.seasonality,
          stationStatus: stn.status,
          stationType: stn.type,
          peakPop: stn.peak_pop,
          elevation: stn.elevation_m,
          notes: stn.notes,
          photoUrl: stn.photo_url,
          webcamUrl: stn.webcam_url,
        },
      });
      entities.push(entity);
    });
  }

  function renderProtectedAreas() {
    if (!allData.protected_areas) return;
    const pa = allData.protected_areas;

    // ASPAs
    (pa.notable_aspas || []).forEach(aspa => {
      const entity = dataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(aspa.lon, aspa.lat),
        point: {
          pixelSize: 6,
          color: Cesium.Color.fromCssColorString('#34d399').withAlpha(0.5),
          outlineColor: Cesium.Color.fromCssColorString('#34d399'),
          outlineWidth: 1,
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 5e6, 0.4),
        },
        label: {
          text: 'ASPA ' + aspa.number,
          font: '9px monospace',
          fillColor: Cesium.Color.fromCssColorString('#34d399').withAlpha(0.7),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 8),
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 2e6, 0),
          show: true,
        },
        properties: {
          type: 'antarctica',
          subType: 'aspa',
          name: aspa.name,
          number: aspa.number,
          notes: aspa.reason,
        },
      });
      entities.push(entity);
    });

    // ASMAs
    (pa.asma_list || []).forEach(asma => {
      const entity = dataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(asma.lon, asma.lat),
        point: {
          pixelSize: 8,
          color: Cesium.Color.fromCssColorString('#2dd4bf').withAlpha(0.4),
          outlineColor: Cesium.Color.fromCssColorString('#2dd4bf'),
          outlineWidth: 1,
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 5e6, 0.4),
        },
        label: {
          text: 'ASMA: ' + asma.name,
          font: '9px monospace',
          fillColor: Cesium.Color.fromCssColorString('#2dd4bf').withAlpha(0.7),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 10),
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 2e6, 0),
          show: true,
        },
        properties: {
          type: 'antarctica',
          subType: 'asma',
          name: asma.name,
          number: asma.number,
          notes: asma.description,
        },
      });
      entities.push(entity);
    });
  }

  function renderHistoricSites() {
    if (!allData.historic_sites) return;
    const color = '#d97706';

    allData.historic_sites.forEach(site => {
      const entity = dataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat),
        billboard: {
          image: createHistoricIcon(color),
          width: 20,
          height: 20,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1.2, 5e6, 0.5),
        },
        label: {
          text: site.name,
          font: '10px monospace',
          fillColor: Cesium.Color.fromCssColorString(color).withAlpha(0.85),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 14),
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 3e6, 0.3),
          show: true,
        },
        properties: {
          type: 'antarctica',
          subType: 'historic',
          name: site.name,
          year: site.year,
          expedition: site.expedition,
          explorer: site.explorer,
          hsm: site.hsm,
          notes: site.notes,
          lat: site.lat,
          lon: site.lon,
        },
      });
      entities.push(entity);
    });
  }

  function renderMilitaryOps() {
    if (!allData.military_operations) return;
    const color = '#ef4444';

    allData.military_operations.forEach(op => {
      if (!op.key_locations) return;

      op.key_locations.forEach(loc => {
        const entity = dataSource.entities.add({
          position: Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat),
          billboard: {
            image: createMilitaryIcon(color),
            width: 18,
            height: 18,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: 0,
            scaleByDistance: new Cesium.NearFarScalar(1e4, 1.2, 5e6, 0.5),
          },
          label: {
            text: loc.name,
            font: '10px monospace',
            fillColor: Cesium.Color.fromCssColorString(color).withAlpha(0.85),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(0, 14),
            disableDepthTestDistance: 0,
            scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 3e6, 0.3),
            show: true,
          },
          properties: {
            type: 'antarctica',
            subType: 'military',
            name: loc.name,
            operationName: op.name,
            operationOfficialName: op.official_name,
            dates: op.dates,
            commander: op.commander,
            personnel: op.personnel,
            ships: op.ships,
            aircraft: op.aircraft,
            notes: loc.notes || '',
            achievements: op.achievements ? op.achievements.join('; ') : '',
            earlyTermination: op.early_termination || '',
            earlyTerminationReason: op.early_termination_reason || '',
            byrdQuote: op.byrd_el_mercurio_quote || '',
            quoteCaveat: op.quote_caveat || '',
            lat: loc.lat,
            lon: loc.lon,
          },
        });
        entities.push(entity);
      });
    });
  }

  function renderDisclosureSites() {
    if (!allData.disclosure_and_anomalies) return;
    const disc = allData.disclosure_and_anomalies;

    // Lake Vostok
    if (disc.lake_vostok && disc.lake_vostok.lat) {
      const lv = disc.lake_vostok;
      const entity = dataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lv.lon, lv.lat),
        billboard: {
          image: createDisclosureIcon('#c084fc'),
          width: 22, height: 22,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1.2, 5e6, 0.6),
        },
        label: {
          text: 'Lake Vostok',
          font: '10px monospace',
          fillColor: Cesium.Color.fromCssColorString('#c084fc').withAlpha(0.9),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 14),
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 3e6, 0.4),
          show: true,
        },
        properties: {
          type: 'antarctica',
          subType: 'disclosure',
          name: 'Lake Vostok',
          description: lv.dimensions + '. Sealed ' + lv.age_estimate + '. Drill breakthrough: ' + lv.drilling_breakthrough,
          findings: (lv.findings || []).join('; '),
          lat: lv.lat, lon: lv.lon,
        },
      });
      entities.push(entity);
    }

    // Neuschwabenland / Base 211 (approximate coordinates)
    if (disc.neuschwabenland_base_211) {
      const ns = disc.neuschwabenland_base_211;
      const entity = dataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(2.5, -72.5),
        billboard: {
          image: createDisclosureIcon('#f87171'),
          width: 22, height: 22,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1.2, 5e6, 0.6),
        },
        label: {
          text: 'Neuschwabenland / Base 211',
          font: '10px monospace',
          fillColor: Cesium.Color.fromCssColorString('#f87171').withAlpha(0.9),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 14),
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 3e6, 0.4),
          show: true,
        },
        properties: {
          type: 'antarctica',
          subType: 'disclosure',
          name: 'Neuschwabenland / Base 211',
          description: ns.claim,
          findings: ns.evidence_status || '',
          lat: -72.5, lon: 2.5,
        },
      });
      entities.push(entity);
    }

    // Pyramid structures
    if (disc.pyramid_structures) {
      const ps = disc.pyramid_structures;
      const lat = ps.location_approx ? ps.location_approx.lat : null;
      const lon = ps.location_approx ? ps.location_approx.lon : null;
      if (lat && lon) {
        const entity = dataSource.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat),
          billboard: {
            image: createDisclosureIcon('#fbbf24'),
            width: 22, height: 22,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: 0,
            scaleByDistance: new Cesium.NearFarScalar(1e4, 1.2, 5e6, 0.6),
          },
          label: {
            text: 'Antarctic "Pyramids"',
            font: '10px monospace',
            fillColor: Cesium.Color.fromCssColorString('#fbbf24').withAlpha(0.9),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(0, 14),
            disableDepthTestDistance: 0,
            scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 3e6, 0.4),
            show: true,
          },
          properties: {
            type: 'antarctica',
            subType: 'disclosure',
            name: 'Antarctic "Pyramids"',
            description: ps.claim,
            findings: ps.reality || '',
            lat: lat, lon: lon,
          },
        });
        entities.push(entity);
      }
    }

    // High-profile 2016 visits
    if (disc.high_profile_visits_2016) {
      disc.high_profile_visits_2016.forEach(visit => {
        if (!visit.lat || !visit.lon) return;
        const entity = dataSource.entities.add({
          position: Cesium.Cartesian3.fromDegrees(visit.lon, visit.lat),
          billboard: {
            image: createDisclosureIcon('#a78bfa'),
            width: 20, height: 20,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            disableDepthTestDistance: 0,
            scaleByDistance: new Cesium.NearFarScalar(1e4, 1.2, 5e6, 0.6),
          },
          label: {
            text: visit.who,
            font: '10px monospace',
            fillColor: Cesium.Color.fromCssColorString('#a78bfa').withAlpha(0.85),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            pixelOffset: new Cesium.Cartesian2(0, 14),
            disableDepthTestDistance: 0,
            scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 3e6, 0.3),
            show: true,
          },
          properties: {
            type: 'antarctica',
            subType: 'visit',
            name: visit.who,
            when: visit.when,
            location: visit.location,
            officialReason: visit.official_reason,
            notes: visit.notes,
            lat: visit.lat, lon: visit.lon,
          },
        });
        entities.push(entity);
      });
    }

    // Warm caves / Mt Erebus biodiversity
    if (disc.warm_caves_biodiversity && disc.warm_caves_biodiversity.lat) {
      const wc = disc.warm_caves_biodiversity;
      const entity = dataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(wc.lon, wc.lat),
        billboard: {
          image: createDisclosureIcon('#fb923c'),
          width: 20, height: 20,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1.2, 5e6, 0.6),
        },
        label: {
          text: 'Warm Caves / Mt Erebus',
          font: '10px monospace',
          fillColor: Cesium.Color.fromCssColorString('#fb923c').withAlpha(0.85),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 14),
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 3e6, 0.3),
          show: true,
        },
        properties: {
          type: 'antarctica',
          subType: 'disclosure',
          name: 'Volcanic Warm Caves',
          description: 'Warm caves formed by volcanic heat under glacial ice on Mount Erebus.',
          findings: Array.isArray(wc.findings) ? wc.findings.join('; ') : (wc.findings || ''),
          lat: wc.lat, lon: wc.lon,
        },
      });
      entities.push(entity);
    }
  }

  function renderGeographicFeatures() {
    if (!allData.key_geographic_features) return;
    const color = '#e2e8f0';

    allData.key_geographic_features.forEach(feat => {
      const entity = dataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(feat.lon, feat.lat),
        billboard: {
          image: createFeatureIcon(color),
          width: 14, height: 14,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 5e6, 0.4),
        },
        label: {
          text: feat.name,
          font: '9px monospace',
          fillColor: Cesium.Color.fromCssColorString(color).withAlpha(0.7),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 10),
          disableDepthTestDistance: 0,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 3e6, 0.3),
          show: true,
        },
        properties: {
          type: 'antarctica',
          subType: 'geographic',
          name: feat.name,
          notes: feat.notes || '',
          elevation: feat.elevation_m || null,
          lat: feat.lat,
          lon: feat.lon,
        },
      });
      entities.push(entity);
    });
  }

  // ── Public Interface ──────────────────────────────────────────────

  function setVisible(v) {
    visible = v;
    dataSource.show = v;
    if (viewer) viewer.scene.requestRender();
  }

  function isVisible() { return visible; }

  function getCount() { return entities.length; }

  function updateStats() {
    const el = document.getElementById('stat-antarctica');
    if (el) el.textContent = entities.length ? entities.length + ' sites' : '—';
  }

  function setLabelsVisible(show) {
    dataSource.entities.values.forEach(e => {
      if (e.label) e.label.show = show;
    });
  }

  function setTime() {
    // Static layer — no time filtering
  }

  return { init, setVisible, isVisible, getCount, setLabelsVisible, setTime };
})();
