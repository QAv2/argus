// controls.js — UI panels, filters, keyboard shortcuts

const Controls = (() => {
  let presets = [];
  let labelsVisible = true;

  function toggleAllLabels() {
    labelsVisible = !labelsVisible;
    Earthquakes.setLabelsVisible(labelsVisible);
    Satellites.setLabelsVisible(labelsVisible);
    Aircraft.setLabelsVisible(labelsVisible);
    Bases.setLabelsVisible(labelsVisible);
    Military.setLabelsVisible(labelsVisible);
    Intel.setLabelsVisible(labelsVisible);
    Vessels.setLabelsVisible(labelsVisible);
    Traffic.setLabelsVisible(labelsVisible);
    Conflicts.setLabelsVisible(labelsVisible);
    if (typeof Playback !== 'undefined') Playback.setLabelsVisible(labelsVisible);
    if (typeof Antarctica !== 'undefined') Antarctica.setLabelsVisible(labelsVisible);
    if (typeof SatCorrelation !== 'undefined') SatCorrelation.setLabelsVisible(labelsVisible);
    const labelsEl = document.getElementById('labels-toggle');
    labelsEl.classList.toggle('off', !labelsVisible);
    labelsEl.setAttribute('aria-checked', String(labelsVisible));
  }

  function toggleCrosshair() {
    const ch = document.getElementById('crosshair');
    const isVisible = ch.style.display !== 'none';
    ch.style.display = isVisible ? 'none' : 'block';
    const crosshairEl = document.getElementById('crosshair-toggle');
    crosshairEl.classList.toggle('off', isVisible);
    crosshairEl.setAttribute('aria-checked', String(!isVisible));
  }

  const LAYERS = [
    { id: 'earthquakes', name: 'Earthquakes', color: 'var(--quake-shallow)', key: 'F1', module: () => Earthquakes },
    { id: 'satellites', name: 'Satellites', color: 'var(--sat-color)', key: 'F2', module: () => Satellites },
    { id: 'aircraft', name: 'Aircraft', color: 'var(--aircraft-civil)', key: 'F3', module: () => Aircraft },
    { id: 'bases', name: 'Underground Bases', color: 'var(--base-color)', key: 'F4', module: () => Bases },
    { id: 'military', name: 'Military Bases', color: 'var(--military-color)', key: 'F5', module: () => Military },
    { id: 'intel', name: 'Intel Network', color: 'var(--accent)', key: 'F6', module: () => Intel },
    { id: 'vessels', name: 'Naval Vessels', color: 'var(--vessel-color)', key: 'F7', module: () => Vessels },
    { id: 'traffic', name: 'Traffic Flow', color: 'var(--traffic-color)', key: 'F8', module: () => Traffic },
    { id: 'conflicts', name: 'Conflict Events', color: 'var(--conflict-color)', key: 'F9', module: () => Conflicts },
    { id: 'playback', name: 'Replay Data', color: 'var(--playback-color)', key: 'F10', module: () => Playback },
    { id: 'antarctica', name: 'Antarctica', color: 'var(--antarctica-color)', key: 'A', module: () => Antarctica },
  ];

  const MODES = [
    { id: 'normal', name: 'Normal', key: '0' },
    { id: 'crt', name: 'CRT', key: '1' },
    { id: 'nvg', name: 'NVG', key: '2' },
    { id: 'flir', name: 'FLIR', key: '3' },
  ];

  async function init() {
    // Load presets
    try {
      const resp = await fetch('data/presets.json');
      presets = await resp.json();
    } catch {
      presets = [];
    }

    buildBaseLayerSwitcher();
    buildModeButtons();
    buildLayerToggles();
    buildTheaterFilters();
    buildPresetButtons();
    buildReplayPanel();
    setupKeyboard();
    setupMouse();
    setupMiscToggles();
    startClock();
  }

  function buildBaseLayerSwitcher() {
    const container = document.getElementById('base-layer-buttons');
    const layers = Globe.getBaseLayerList();
    layers.forEach(layer => {
      const btn = document.createElement('button');
      btn.className = 'mode-btn' + (layer.id === Globe.getBaseLayerId() ? ' active' : '');
      btn.textContent = layer.name;
      btn.dataset.layerId = layer.id;
      btn.addEventListener('click', () => {
        Globe.setBaseLayer(layer.id);
        container.querySelectorAll('.mode-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.layerId === layer.id);
        });
        if (typeof HashState !== 'undefined') HashState.update();
      });
      container.appendChild(btn);
    });
  }

  function buildModeButtons() {
    const container = document.getElementById('mode-buttons');
    MODES.forEach(mode => {
      const btn = document.createElement('button');
      btn.className = 'mode-btn' + (mode.id === 'normal' ? ' active' : '');
      btn.innerHTML = `${mode.name} <span class="layer-key">${mode.key}</span>`;
      btn.addEventListener('click', () => setMode(mode.id));
      container.appendChild(btn);
    });
  }

  function setMode(modeId) {
    Shaders.setMode(modeId);
    document.querySelectorAll('#mode-buttons .mode-btn').forEach((btn, i) => {
      btn.classList.toggle('active', MODES[i].id === modeId);
    });
    if (typeof HashState !== 'undefined') HashState.update();
  }

  function buildLayerToggles() {
    const container = document.getElementById('layer-toggles');
    LAYERS.forEach(layer => {
      const div = document.createElement('div');
      div.className = 'layer-toggle';
      div.id = `toggle-${layer.id}`;
      div.setAttribute('role', 'checkbox');
      div.setAttribute('aria-checked', 'true');
      div.tabIndex = 0;
      div.innerHTML = `
        <div class="dot" style="background:${layer.color}"></div>
        <span class="layer-label">${layer.name}</span>
        <span class="layer-count" id="count-${layer.id}">—</span>
        <span class="layer-key">${layer.key}</span>
      `;
      div.addEventListener('click', () => toggleLayer(layer.id));
      div.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          div.click();
        }
      });
      container.appendChild(div);
    });
  }

  function toggleLayer(layerId) {
    const layer = LAYERS.find(l => l.id === layerId);
    if (!layer) return;
    const mod = layer.module();
    const newState = !mod.isVisible();
    mod.setVisible(newState);
    const el = document.getElementById(`toggle-${layerId}`);
    if (el) {
      el.classList.toggle('off', !newState);
      el.setAttribute('aria-checked', String(newState));
    }
    if (typeof HashState !== 'undefined') HashState.update();
  }

  function ensureLayerVisible(layerId) {
    const layer = LAYERS.find(l => l.id === layerId);
    if (!layer) return;
    const mod = layer.module();
    if (!mod.isVisible()) toggleLayer(layerId);
  }

  function activatePreset(preset) {
    Globe.flyTo(preset.lon, preset.lat, preset.altitude);
    if (preset.layer) ensureLayerVisible(preset.layer);
  }

  function buildTheaterFilters() {
    const container = document.getElementById('theater-toggles');
    if (!container) return;

    const theaters = Conflicts.getTheaters();
    theaters.forEach(theater => {
      const div = document.createElement('div');
      div.className = 'layer-toggle';
      div.id = `theater-${theater.id}`;
      div.setAttribute('role', 'checkbox');
      div.setAttribute('aria-checked', 'true');
      div.tabIndex = 0;
      div.innerHTML = `
        <div class="dot" style="background:${theater.color}"></div>
        <span class="layer-label">${theater.name}</span>
      `;
      div.addEventListener('click', () => {
        Conflicts.toggleTheater(theater.id);
        const active = Conflicts.isTheaterActive(theater.id);
        div.classList.toggle('off', !active);
        div.setAttribute('aria-checked', String(active));
        if (typeof HashState !== 'undefined') HashState.update();
      });
      div.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          div.click();
        }
      });
      container.appendChild(div);
    });

    document.getElementById('theaters-all')?.addEventListener('click', () => {
      Conflicts.setAllTheaters(true);
      container.querySelectorAll('.layer-toggle').forEach(el => {
        el.classList.remove('off');
        el.setAttribute('aria-checked', 'true');
      });
      if (typeof HashState !== 'undefined') HashState.update();
    });

    document.getElementById('theaters-none')?.addEventListener('click', () => {
      Conflicts.setAllTheaters(false);
      container.querySelectorAll('.layer-toggle').forEach(el => {
        el.classList.add('off');
        el.setAttribute('aria-checked', 'false');
      });
      if (typeof HashState !== 'undefined') HashState.update();
    });
  }

  function buildPresetButtons() {
    const container = document.getElementById('preset-buttons');
    presets.forEach(preset => {
      const btn = document.createElement('button');
      btn.className = 'preset-btn';
      btn.innerHTML = `
        <span class="preset-key">${preset.key}</span>
        <span>${preset.name}</span>
      `;
      btn.addEventListener('click', () => {
        activatePreset(preset);
      });
      container.appendChild(btn);
    });
  }

  // ── Replay Panel ─────────────────────────────────────────────────────

  function buildReplayPanel() {
    const container = document.getElementById('replay-panel');
    if (!container) return;

    loadReplayIndex().then(replays => {
      if (replays.length === 0) {
        container.innerHTML = '<div style="font-size:11px;color:var(--text-tertiary);padding:4px 0">No captures available</div>';
        return;
      }
      replays.forEach(r => {
        const btn = document.createElement('button');
        btn.className = 'preset-btn replay-btn';
        btn.innerHTML = `
          <span class="replay-dot"></span>
          <span>${r.title}</span>
          <span style="font-size:9px;color:var(--text-tertiary)">${r.frame_count} frames</span>
        `;
        btn.addEventListener('click', () => loadReplayFromPanel(r.slug));
        container.appendChild(btn);
      });
    });
  }

  async function loadReplayIndex() {
    try {
      const resp = await fetch('data/replays/index.json');
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.replays || [];
    } catch {
      return [];
    }
  }

  async function loadReplayFromPanel(slug) {
    console.log(`[Controls] Loading replay: ${slug}`);
    const manifest = await Playback.loadReplay(slug);
    if (!manifest) return;

    // Load associated data for other layers
    if (typeof SatCorrelation !== 'undefined') {
      SatCorrelation.loadCorrelations(manifest);
    }
  }

  // ── Keyboard ─────────────────────────────────────────────────────────

  function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Don't capture if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const key = e.key;

      // Base layer shortcuts (Alt+1-5)
      if (e.altKey && key >= '1' && key <= '6') {
        e.preventDefault();
        const layerIds = ['dark', 'satellite', 'terrain', 'osm', 'voyager', 'google3d'];
        const idx = parseInt(key) - 1;
        if (layerIds[idx]) {
          Globe.setBaseLayer(layerIds[idx]);
          document.querySelectorAll('#base-layer-buttons .mode-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.layerId === layerIds[idx]);
          });
          if (typeof HashState !== 'undefined') HashState.update();
        }
        return;
      }

      // Visual modes
      if (key === '0') setMode('normal');
      if (key === '1') setMode('crt');
      if (key === '2') setMode('nvg');
      if (key === '3') setMode('flir');

      // Timeline controls (T must be before preset check to override Pine Gap)
      if (key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (typeof Timeline !== 'undefined') {
          Timeline.setVisible(!Timeline.isTimelineVisible());
        }
        return;
      }
      if (key === '[') { if (typeof Timeline !== 'undefined') Timeline.stepBack(); return; }
      if (key === ']') { if (typeof Timeline !== 'undefined') Timeline.stepForward(); return; }
      if (key === '\\') { if (typeof Timeline !== 'undefined') Timeline.togglePlay(); return; }
      if (key === 'Backspace' && !e.ctrlKey) {
        e.preventDefault();
        if (typeof Timeline !== 'undefined') Timeline.resetToLive();
        return;
      }

      // Speed controls: { = slower, } = faster
      if (key === '{') {
        if (typeof Timeline !== 'undefined') Timeline.speedDown();
        return;
      }
      if (key === '}') {
        if (typeof Timeline !== 'undefined') Timeline.speedUp();
        return;
      }

      // Antarctica layer toggle
      if (key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        toggleLayer('antarctica');
        return;
      }

      // Satellite correlation toggle
      if (key.toLowerCase() === 'k' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (typeof SatCorrelation !== 'undefined') {
          const mod = SatCorrelation;
          const newState = !mod.isVisible();
          mod.setVisible(newState);
        }
        return;
      }

      // Camera presets
      const preset = presets.find(p => p.key.toLowerCase() === key.toLowerCase());
      if (preset && !e.ctrlKey && !e.metaKey && !e.altKey) {
        activatePreset(preset);
      }

      // Layer toggles (F1-F10)
      if (key.startsWith('F') && !e.ctrlKey) {
        const fNum = parseInt(key.slice(1));
        if (fNum >= 1 && fNum <= LAYERS.length) {
          e.preventDefault();
          toggleLayer(LAYERS[fNum - 1].id);
        }
      }

      // Labels toggle
      if (key.toLowerCase() === 'l') {
        toggleAllLabels();
      }

      // Crosshair toggle
      if (key.toLowerCase() === 'x') {
        toggleCrosshair();
      }

      // Panel toggle
      if (key === 'Tab') {
        e.preventDefault();
        document.getElementById('side-panel').classList.toggle('collapsed');
      }

      // Share URL
      if (key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (typeof HashState !== 'undefined') HashState.copyUrl();
        return;
      }

      // Help
      if (key === '?') {
        document.getElementById('help-overlay').classList.toggle('visible');
      }

      // Escape — close panels
      if (key === 'Escape') {
        Dossier.close();
        document.getElementById('help-overlay').classList.remove('visible');
      }
    });
  }

  function setupMouse() {
    const viewer = Globe.getViewer();
    if (!viewer) return;

    // Click handler for entities
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((click) => {
      // Drill-pick a 24×24 region for forgiving click targets. Falls back to
      // exact pick if drillPick is unavailable in this Cesium version.
      let picked = null;
      if (typeof viewer.scene.drillPick === 'function') {
        const drilled = viewer.scene.drillPick(click.position, 5, 24, 24);
        // Find first hit with a usable id (skip globe/imagery hits)
        picked = drilled.find(p => Cesium.defined(p) && p.id) || null;
      }
      if (!picked) picked = viewer.scene.pick(click.position);
      if (!Cesium.defined(picked) || !picked.id) return;

      // Handle both Entity picks (properties bag) and Primitive picks (plain object id)
      let props, type;
      if (picked.id.properties) {
        // Entity API pick (satellites, earthquakes, bases, military, intel)
        props = picked.id.properties;
        type = props.type?.getValue ? props.type.getValue() : props.type;
      } else if (picked.id && picked.id.type) {
        // Primitive pick (aircraft PointPrimitiveCollection — id is a plain object)
        props = picked.id;
        type = props.type;
      } else {
        return;
      }

      switch (type) {
        case 'earthquake':
          Dossier.showEarthquake(props);
          break;
        case 'satellite':
          Dossier.showSatellite(props);
          const satIdx = props.satIndex?.getValue ? props.satIndex.getValue() : props.satIndex;
          if (satIdx !== undefined) Satellites.trackSat(viewer, satIdx);
          break;
        case 'aircraft':
          Dossier.showAircraft(props);
          const hex = props.hex?.getValue ? props.hex.getValue() : props.hex;
          if (hex) Aircraft.trackAircraft(viewer, hex);
          break;
        case 'military':
          const milId = props.id?.getValue ? props.id.getValue() : props.id;
          Dossier.showMilitary(milId);
          break;
        case 'base':
          const baseId = props.id?.getValue ? props.id.getValue() : props.id;
          Dossier.showBase(baseId);
          break;
        case 'intel':
          const entityId = props.id?.getValue ? props.id.getValue() : props.id;
          Dossier.showIntel(entityId);
          break;
        case 'vessel':
          Dossier.showVessel(props);
          break;
        case 'conflict':
          Dossier.showConflict(props);
          break;
        case 'antarctica':
          Dossier.showAntarctica(props);
          break;
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Mouse move for coordinates
    handler.setInputAction((movement) => {
      const coords = Globe.getMouseCoords(movement);
      const el = document.getElementById('coords');
      if (coords) {
        el.textContent = `${coords.lat.toFixed(4)}° ${coords.lon.toFixed(4)}° | ALT ${formatAlt(coords.alt)}`;
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  function setupMiscToggles() {
    document.getElementById('toggle-panel-btn').addEventListener('click', () => {
      document.getElementById('side-panel').classList.toggle('collapsed');
    });

    const labelsEl = document.getElementById('labels-toggle');
    labelsEl.addEventListener('click', () => {
      toggleAllLabels();
    });
    labelsEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        labelsEl.click();
      }
    });

    const crosshairEl = document.getElementById('crosshair-toggle');
    crosshairEl.addEventListener('click', () => {
      toggleCrosshair();
    });
    crosshairEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        crosshairEl.click();
      }
    });

  }

  function startClock() {
    function update() {
      const now = new Date();
      const utc = now.toISOString().slice(11, 19) + ' UTC';
      document.getElementById('utc-clock').textContent = utc;
    }
    update();
    setInterval(update, 1000);
  }

  function formatAlt(meters) {
    if (meters > 100000) return (meters / 1000).toFixed(0) + ' km';
    if (meters > 1000) return (meters / 1000).toFixed(1) + ' km';
    return meters.toFixed(0) + ' m';
  }

  // Update layer counts periodically
  function updateCounts() {
    const counts = {
      earthquakes: Earthquakes.getCount(),
      satellites: Satellites.getCount(),
      aircraft: Aircraft.getCount(),
      bases: Bases.getCount(),
      military: Military.getCount(),
      intel: Intel.getCount(),
      vessels: Vessels.getCount(),
      traffic: Traffic.getCount(),
      conflicts: Conflicts.getCount(),
      playback: typeof Playback !== 'undefined' ? Playback.getCount() : 0,
      antarctica: typeof Antarctica !== 'undefined' ? Antarctica.getCount() : 0,
    };

    Object.entries(counts).forEach(([id, count]) => {
      const el = document.getElementById(`count-${id}`);
      if (el) el.textContent = count || '—';
    });

    const statusEl = document.getElementById('layer-status');
    if (statusEl) {
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      statusEl.textContent = `${total} entities`;
    }
  }

  return { init, updateCounts };
})();
