// hashstate.js — Shareable URL state via hash fragment
// Format: #lat,lon,alt,heading,pitch,roll/layers/base[/mode][/replay:slug]

const HashState = (() => {
  let debounceTimer = null;
  let initialized = false;

  function serialize() {
    const cam = Globe.getCameraState();
    if (!cam) return '';

    const camStr = [
      cam.lat.toFixed(4),
      cam.lon.toFixed(4),
      Math.round(cam.alt),
      cam.heading.toFixed(1),
      cam.pitch.toFixed(1),
      cam.roll.toFixed(1),
    ].join(',');

    // 11-bit layer mask: F1-F9 + Playback + Antarctica
    const modules = [
      Earthquakes, Satellites, Aircraft, Bases, Military, Intel, Vessels, Traffic, Conflicts,
      typeof Playback !== 'undefined' ? Playback : null,
      typeof Antarctica !== 'undefined' ? Antarctica : null,
    ];
    const layers = modules.map(m => (m && m.isVisible()) ? '1' : '0').join('');

    const base = Globe.getBaseLayerId();
    const mode = Shaders.getMode();

    let hash = `${camStr}/${layers}/${base}`;
    if (mode !== 'normal') hash += `/${mode}`;

    // Add replay slug if active
    if (typeof Playback !== 'undefined' && Playback.isReplayActive()) {
      const replay = Playback.getReplay();
      if (replay) hash += `/replay:${replay.slug}`;
    }

    const theaterMask = Conflicts.getTheaterMask();
    if (theaterMask && !theaterMask.split('').every(b => b === '1')) {
      hash += `/theaters:${theaterMask}`;
    }

    return hash;
  }

  function parse() {
    const hash = window.location.hash.slice(1);
    if (!hash) return null;

    const parts = hash.split('/');
    if (parts.length < 2) return null;

    const camParts = parts[0].split(',').map(Number);
    if (camParts.length < 3 || camParts.some(isNaN)) return null;

    const state = {
      camera: {
        lat: camParts[0],
        lon: camParts[1],
        alt: camParts[2],
        heading: camParts.length > 3 ? camParts[3] : 0,
        pitch: camParts.length > 4 ? camParts[4] : -90,
        roll: camParts.length > 5 ? camParts[5] : 0,
      },
    };

    // Accept 8-13 bit layer masks (backward compatible — old URLs may have F11/F12 bits)
    if (parts[1] && /^[01]{8,13}$/.test(parts[1])) {
      state.layers = parts[1];
    }

    if (parts[2]) state.base = parts[2];

    // Parse remaining parts (mode, replay)
    for (let i = 3; i < parts.length; i++) {
      const p = parts[i];
      if (p.startsWith('replay:')) {
        state.replay = p.slice(7);
      } else if (p.startsWith('theaters:')) {
        state.theaters = p.slice(9);
      } else if (['normal', 'crt', 'nvg', 'flir'].includes(p)) {
        state.mode = p;
      }
    }

    return state;
  }

  function applyCamera(state) {
    if (!state || !state.camera) return;
    const viewer = Globe.getViewer();
    if (!viewer) return;

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        state.camera.lon, state.camera.lat, state.camera.alt
      ),
      orientation: {
        heading: Cesium.Math.toRadians(state.camera.heading),
        pitch: Cesium.Math.toRadians(state.camera.pitch),
        roll: Cesium.Math.toRadians(state.camera.roll),
      },
    });
  }

  function applySettings(state) {
    if (!state) return;

    if (state.base) {
      Globe.setBaseLayer(state.base);
      document.querySelectorAll('#base-layer-buttons .mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.layerId === state.base);
      });
    }

    if (state.mode) {
      Shaders.setMode(state.mode);
      const modes = ['normal', 'crt', 'nvg', 'flir'];
      document.querySelectorAll('#mode-buttons .mode-btn').forEach((btn, i) => {
        btn.classList.toggle('active', modes[i] === state.mode);
      });
    }

    // Load replay if specified in hash
    if (state.replay && typeof Playback !== 'undefined') {
      Playback.loadReplay(state.replay);
    }

    if (state.theaters) {
      Conflicts.applyTheaterMask(state.theaters);
      const theaters = Conflicts.getTheaters();
      theaters.forEach(t => {
        const el = document.getElementById(`theater-${t.id}`);
        if (el) {
          const active = Conflicts.isTheaterActive(t.id);
          el.classList.toggle('off', !active);
          el.setAttribute('aria-checked', String(active));
        }
      });
    }
  }

  function applyLayers(state) {
    if (!state || !state.layers) return;

    // All modules in order — matches serialize() order
    const modules = [
      Earthquakes, Satellites, Aircraft, Bases, Military, Intel, Vessels, Traffic, Conflicts,
      typeof Playback !== 'undefined' ? Playback : null,
      typeof Antarctica !== 'undefined' ? Antarctica : null,
    ];
    const layerIds = [
      'earthquakes', 'satellites', 'aircraft', 'bases', 'military', 'intel', 'vessels', 'traffic', 'conflicts',
      'playback', 'antarctica',
    ];

    // Apply as many bits as the hash provides (Math.min for old 8-bit URLs)
    const bitCount = Math.min(state.layers.length, modules.length);
    for (let i = 0; i < bitCount; i++) {
      const mod = modules[i];
      if (!mod) continue;
      const shouldBeVisible = state.layers[i] === '1';
      const isVis = mod.isVisible();
      if (shouldBeVisible !== isVis) {
        mod.setVisible(shouldBeVisible);
        const el = document.getElementById(`toggle-${layerIds[i]}`);
        if (el) el.classList.toggle('off', !shouldBeVisible);
      }
    }
  }

  function update() {
    if (!initialized) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const hash = serialize();
      if (hash) history.replaceState(null, '', '#' + hash);
    }, 500);
  }

  function copyUrl() {
    const hash = serialize();
    if (hash) history.replaceState(null, '', '#' + hash);
    const btn = document.getElementById('share-btn');
    navigator.clipboard.writeText(window.location.href).then(() => {
      const indicator = document.getElementById('mode-indicator');
      indicator.textContent = 'URL COPIED';
      indicator.className = 'visible';
      setTimeout(() => indicator.classList.remove('visible'), 2000);
      btn.setAttribute('aria-label', 'URL copied to clipboard');
      setTimeout(() => btn.setAttribute('aria-label', 'Copy shareable URL'), 2000);
    });
  }

  function init() {
    const viewer = Globe.getViewer();
    if (!viewer) return;
    viewer.camera.moveEnd.addEventListener(update);
    document.getElementById('share-btn').addEventListener('click', copyUrl);
    initialized = true;
    update();
  }

  return { parse, applyCamera, applySettings, applyLayers, update, copyUrl, init };
})();
