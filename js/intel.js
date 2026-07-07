// intel.js — Intel network overlay: curated disclosure entities + intel-console cross-origin feed

const Intel = (() => {
  let entities = [];
  let pulseEntities = [];
  let visible = false; // off by default (dense layer)
  let intelData = [];
  let consoleSignals = [];
  let pulseInterval = null;
  let viewerRef = null;

  const INTEL_CONSOLE_BASE = 'https://qav2.github.io/intel-console/static/data';

  // Curated disclosure entities — blue family, string IDs
  const INTEL_ENTITIES = [
    { id: 'pentagon', name: 'The Pentagon', lat: 38.8719, lon: -77.0563, type: 'facility', tier: 'documented', description: 'US Department of Defense headquarters. Houses OUSD(I&S), DIA, and UAP disclosure oversight functions.', source: 'curated' },
    { id: 'langley', name: 'CIA Headquarters', lat: 38.9517, lon: -77.1467, type: 'facility', tier: 'documented', description: 'Central Intelligence Agency, Langley VA. ORD (Office of Research & Development) linked to consciousness research programs.', source: 'curated' },
    { id: 'nsa-ft-meade', name: 'NSA Fort Meade', lat: 39.1086, lon: -76.7714, type: 'facility', tier: 'documented', description: 'National Security Agency headquarters. SIGINT collection, connected to Five Eyes/ECHELON network.', source: 'curated' },
    { id: 'dia-bolling', name: 'DIA / Bolling AFB', lat: 38.8396, lon: -76.9528, type: 'facility', tier: 'documented', description: 'Defense Intelligence Agency. Ran AAWSAP/AATIP ($22M, 2007-2012). 38 Defense Intelligence Reference Documents (DIRDs).', source: 'curated' },
    { id: 'battelle', name: 'Battelle Memorial Institute', lat: 39.9950, lon: -82.9821, type: 'organization', tier: 'credible', description: 'Manages 7 national labs. Named in Grusch testimony and Wilson-Davis memo as materials custodian.', source: 'curated' },
    { id: 'lockheed-skunkworks', name: 'Lockheed Skunk Works', lat: 34.6366, lon: -118.0847, type: 'organization', tier: 'credible', description: 'Lockheed Martin Advanced Development Programs (Palmdale). Named in multiple retrieval program allegations.', source: 'curated' },
    { id: 'wright-pat-fti', name: 'Wright-Patterson FTD', lat: 39.8261, lon: -84.0483, type: 'facility', tier: 'credible', description: 'Foreign Technology Division (now NASIC). Historical center for recovered material analysis per Goldwater, Corso.', source: 'curated' },
    { id: 'livermore', name: 'Lawrence Livermore NL', lat: 37.6879, lon: -121.7044, type: 'facility', tier: 'documented', description: 'LLNL. Nuclear weapons lab. Connected to Z Division (intelligence). AAWSAP subcontractor.', source: 'curated' },
    { id: 'los-alamos-intel', name: 'Los Alamos NL', lat: 35.8800, lon: -106.3031, type: 'facility', tier: 'documented', description: 'LANL. Manhattan Project origin. Active nuclear weapons + exotic materials research.', source: 'curated' },
    { id: 'bigelow-lv', name: 'Bigelow Aerospace', lat: 36.0788, lon: -115.0200, type: 'organization', tier: 'documented', description: 'Robert Bigelow\'s aerospace company, Las Vegas. Received AAWSAP contract. BAASS subcontractor for UAP investigation.', source: 'curated' },
    { id: 'skinwalker', name: 'Skinwalker Ranch', lat: 40.2588, lon: -109.8880, type: 'location', tier: 'credible', description: 'Uintah Basin, UT. NIDS then BAASS/AAWSAP research site. Anomalous phenomena documented by Kelleher/Knapp.', source: 'curated' },
    { id: 'wilson-davis-loc', name: 'EG&G / Nevada Test Site', lat: 36.7906, lon: -116.1892, type: 'facility', tier: 'credible', description: 'EG&G Special Projects. Wilson-Davis memo implicates test site contractor in reverse engineering program.', source: 'curated' },
    { id: 'capitol-hill', name: 'US Capitol', lat: 38.8899, lon: -77.0091, type: 'facility', tier: 'documented', description: 'Congressional oversight. AARO, Grusch testimony (July 2023), UAPDA legislation, Schumer-Rounds amendment.', source: 'curated' },
    { id: 'raytheon-tucson', name: 'Raytheon Missiles & Defense', lat: 32.1643, lon: -110.8570, type: 'organization', tier: 'credible', description: 'Raytheon (now RTX) missile systems, Tucson AZ. Named in UAP contractor allegations.', source: 'curated' },
    { id: 'northrop-palmdale', name: 'Northrop Grumman', lat: 34.6156, lon: -118.0852, type: 'organization', tier: 'credible', description: 'Northrop Grumman Palmdale facility. B-2/B-21 programs. Named in legacy program allegations.', source: 'curated' },
    { id: 'boeing-phantom', name: 'Boeing Phantom Works', lat: 33.9200, lon: -118.3900, type: 'organization', tier: 'credible', description: 'Boeing classified programs division. St. Louis + satellite locations. Named by Grusch in contractor allegations.', source: 'curated' },
    { id: 'sci-apps', name: 'SAIC/Leidos', lat: 38.9537, lon: -77.3477, type: 'organization', tier: 'credible', description: 'Science Applications International. Former employers of multiple UAP researchers. Government IT contractor.', source: 'curated' },
    { id: 'stanford-sri', name: 'Stanford / SRI International', lat: 37.4545, lon: -122.1750, type: 'organization', tier: 'documented', description: 'SRI International (formerly Stanford Research Institute). Ran Stargate remote viewing program for CIA/DIA.', source: 'curated' },
    { id: 'aaro-hq', name: 'AARO (Pentagon)', lat: 38.8719, lon: -77.0563, type: 'facility', tier: 'documented', description: 'All-domain Anomaly Resolution Office. Established 2022. Kirkpatrick then Phillips. Congressional reporting mandate.', source: 'curated' },
  ];

  // Console entity colors — amber/pink family
  const CONSOLE_COLORS = {
    facility: '#f59e0b',
    organization: '#ec4899',
    agency: '#ef4444',
    person: '#a78bfa',
  };

  async function init(viewer) {
    viewerRef = viewer;
    intelData = [...INTEL_ENTITIES];

    // Non-blocking: merge curated photo URLs from data/intel-photos.json
    // (file is written by tools/photo-approval/apply_approvals.py).
    fetch('data/intel-photos.json', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(map => {
        if (!map) return;
        intelData.forEach(e => { if (map[e.id]) e.photo_url = map[e.id]; });
        renderEntities(viewer);
        Globe.requestRender();
      })
      .catch(() => {});

    renderEntities(viewer);
    Globe.requestRender();

    // Non-blocking: fetch intel-console geo data
    fetchConsoleData(viewer);
  }

  async function fetchConsoleData(viewer) {
    try {
      const [entRes, sigRes] = await Promise.all([
        fetch(`${INTEL_CONSOLE_BASE}/geo-entities.json`),
        fetch(`${INTEL_CONSOLE_BASE}/geo-signals.json`),
      ]);

      if (!entRes.ok) throw new Error(`geo-entities: ${entRes.status}`);

      const geoEntities = await entRes.json();
      const geoSignals = sigRes.ok ? await sigRes.json() : [];

      // Merge console entities with ic- prefix to avoid ID collision
      const consoleEntries = geoEntities.map(e => ({
        id: `ic-${e.id}`,
        name: e.name,
        lat: e.lat,
        lon: e.lon,
        type: e.entity_type,
        tier: e.evidence_tier,
        description: e.description,
        source: 'intel-console',
        centrality: e.centrality,
        connection_count: e.connection_count,
        signal_count: e.signal_count,
        numericId: e.id,
      }));

      intelData = [...INTEL_ENTITIES, ...consoleEntries];
      consoleSignals = geoSignals;

      // Re-render with merged data
      renderEntities(viewer);
      renderPulses(viewer);
      Globe.requestRender();

      console.log(`[Intel] Merged ${consoleEntries.length} console entities, ${geoSignals.length} signals`);
    } catch (err) {
      console.warn('[Intel] Console data unavailable, F6 shows curated only:', err.message);
    }
  }

  function renderEntities(viewer) {
    entities.forEach(e => viewer.entities.remove(e));
    entities = [];

    // Curated: blue family
    const curatedColors = {
      facility: '#f5b942',
      organization: '#c084fc',
      location: '#fbbf24',
      person: '#f87171',
    };

    intelData.forEach(ent => {
      const isConsole = ent.source === 'intel-console';
      const colorMap = isConsole ? CONSOLE_COLORS : curatedColors;
      const color = colorMap[ent.type] || '#f5b942';

      // Console entities: 5px base + centrality scaling (max 12px)
      let pixelSize = 7;
      if (isConsole) {
        pixelSize = Math.min(12, 5 + (ent.centrality || 0) * 25);
      }

      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(ent.lon, ent.lat),
        point: {
          pixelSize,
          color: Cesium.Color.fromCssColorString(color).withAlpha(0.8),
          outlineColor: Cesium.Color.fromCssColorString(color),
          outlineWidth: 2,
          disableDepthTestDistance: 0,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: ent.name,
          font: '10px monospace',
          fillColor: Cesium.Color.fromCssColorString(color).withAlpha(0.8),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          disableDepthTestDistance: 0,
          show: true,
          scaleByDistance: new Cesium.NearFarScalar(1e5, 1, 3e6, 0.4),
        },
        properties: {
          type: 'intel',
          id: ent.id,
          name: ent.name,
          entityType: ent.type,
          evidence_tier: ent.tier,
          description: ent.description,
          source: ent.source || 'curated',
          centrality: ent.centrality || 0,
          connection_count: ent.connection_count || 0,
          signal_count: ent.signal_count || 0,
        },
        show: visible,
      });

      entities.push(entity);
    });
  }

  function renderPulses(viewer) {
    // Clear existing pulses
    pulseEntities.forEach(e => viewer.entities.remove(e));
    pulseEntities = [];
    if (pulseInterval) {
      clearInterval(pulseInterval);
      pulseInterval = null;
    }

    if (consoleSignals.length === 0) return;

    // Pre-cache pulse base color (avoids Color.fromCssColorString per frame)
    const PULSE_BASE = Cesium.Color.fromCssColorString('#f59e0b');

    // Group signals by location (lat/lon key)
    const locGroups = {};
    consoleSignals.forEach(s => {
      const key = `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`;
      if (!locGroups[key]) {
        locGroups[key] = { lat: s.lat, lon: s.lon, signals: [], entity_name: s.entity_name };
      }
      locGroups[key].signals.push(s);
    });

    // Cap at 50 pulse locations
    const locations = Object.values(locGroups).slice(0, 50);
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;

    locations.forEach(loc => {
      const newest = loc.signals[0];
      const age = now - new Date(newest.collected_at).getTime();
      const isRecent = age < DAY_MS;
      const baseAlpha = isRecent ? 0.6 : 0.25;
      const baseRadius = isRecent ? 25000 : 15000;

      const phase = Math.random() * Math.PI * 2;
      // Pre-allocate scratch color — mutated in place each frame (zero allocation)
      const scratchColor = PULSE_BASE.clone();

      // Single shared callback for both semi-axes (identical value, halves callback count)
      const axisCallback = new Cesium.CallbackProperty(() => {
        const t = (Date.now() % 3000) / 3000;
        return baseRadius + Math.sin(t * Math.PI * 2 + phase) * baseRadius * 0.5;
      }, false);

      const pulseEntity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat),
        ellipse: {
          semiMajorAxis: axisCallback,
          semiMinorAxis: axisCallback,
          material: new Cesium.ColorMaterialProperty(
            new Cesium.CallbackProperty(() => {
              const t = (Date.now() % 3000) / 3000;
              scratchColor.alpha = baseAlpha * (0.3 + 0.7 * Math.abs(Math.sin(t * Math.PI + phase)));
              return scratchColor;
            }, false)
          ),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        properties: {
          type: 'signal-pulse',
          signalCount: loc.signals.length,
        },
        show: visible,
      });

      pulseEntities.push(pulseEntity);
    });

    // Drive render at 10fps for pulse animation
    pulseInterval = setInterval(() => {
      if (visible) Globe.requestRender();
    }, 100);
  }

  function setVisible(v) {
    visible = v;
    entities.forEach(e => { e.show = v; });
    pulseEntities.forEach(e => { e.show = v; });
    Globe.requestRender();
  }

  function isVisible() { return visible; }
  function getCount() { return intelData.length; }

  function getEntityById(id) {
    return intelData.find(e => e.id === id);
  }

  function getSignalsForEntity(entityId) {
    // entityId comes in as 'ic-{num}', extract numeric part
    const numId = typeof entityId === 'string' && entityId.startsWith('ic-')
      ? parseInt(entityId.slice(3), 10)
      : null;
    if (numId === null) return [];
    return consoleSignals.filter(s => s.entity_id === numId);
  }

  function setLabelsVisible(show) {
    entities.forEach(e => {
      if (e.label) e.label.show = show;
    });
  }

  return { init, setVisible, isVisible, getCount, getEntityById, getSignalsForEntity, setLabelsVisible };
})();
