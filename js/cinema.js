/*
 * cinema.js — Deterministic URL-driven rendering surface for ARGUS globe.
 * See ../CINEMA_MODE.md for the spec.
 *
 * Activates only when `?cinema=1` is set in the query string. Normal users
 * pay zero cost — the whole module short-circuits on the first line.
 */
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  if (params.get('cinema') !== '1') return;

  var VERSION = 1;
  var FALLBACK_TIMEOUT_MS = 30000;

  console.log('[cinema] init v' + VERSION);

  // ---- Readiness emission ---------------------------------------------------

  function emitReady(cue) {
    var payload = {
      type: 'cinema:ready',
      cue: cue,
      timestamp: performance.now(),
    };
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*');
      }
    } catch (e) {
      console.warn('[cinema] postMessage failed:', e);
    }
    try {
      window.dispatchEvent(new CustomEvent('cinema-ready', { detail: payload }));
    } catch (e) { /* non-fatal */ }
    console.log('[cinema] ready:', cue);
  }

  // ---- Cue parsing ----------------------------------------------------------

  function parseCue(hash) {
    if (!hash || hash.indexOf('#cinema/') !== 0) return null;
    var body = hash.slice('#cinema/'.length);
    if (!body) return null;
    var parts = body.split('/');
    var command = parts[0];
    var target = null;
    var cueParams = {};

    for (var i = 1; i < parts.length; i++) {
      var part = parts[i];
      var colonIdx = part.indexOf(':');
      if (colonIdx === -1 && target === null) {
        target = part;
      } else if (colonIdx !== -1) {
        var key = part.slice(0, colonIdx);
        var val = part.slice(colonIdx + 1);
        cueParams[key] = val;
      }
    }

    return { command: command, target: target, params: cueParams, raw: hash };
  }

  // ---- Helpers --------------------------------------------------------------

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function doubleRaf() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(resolve);
      });
    });
  }

  /** Resolves when Globe.getViewer() exists with a live scene. */
  function waitForApp() {
    return new Promise(function (resolve) {
      function check() {
        if (typeof Globe !== 'undefined' && Globe.getViewer() && Globe.getViewer().scene) {
          resolve();
          return;
        }
        setTimeout(check, 50);
      }
      check();
    });
  }

  /**
   * Wait for all terrain tiles in the current view to finish loading.
   * Without this gate, cinema output shows low-res tiles popping to
   * high-res mid-shot — the single biggest Cesium recording artifact.
   */
  function waitForTilesLoaded(viewer, timeoutMs) {
    timeoutMs = timeoutMs || 10000;
    return new Promise(function (resolve) {
      var start = performance.now();
      function check() {
        if (viewer.scene.globe.tilesLoaded) {
          resolve();
          return;
        }
        if (performance.now() - start > timeoutMs) {
          console.warn('[cinema] tilesLoaded timeout after ' + timeoutMs + 'ms');
          resolve();
          return;
        }
        viewer.scene.requestRender();
        setTimeout(check, 100);
      }
      check();
    });
  }

  /** camera.flyTo wrapped as a promise. */
  function flyToAsync(viewer, options) {
    return new Promise(function (resolve) {
      var opts = Object.assign({}, options, {
        complete: function () { resolve(true); },
        cancel: function () { resolve(false); },
      });
      viewer.camera.flyTo(opts);
    });
  }

  // ---- Preset registry ------------------------------------------------------

  var presetCache = null;

  function getPresets() {
    if (presetCache) return Promise.resolve(presetCache);
    return fetch('data/presets.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { presetCache = data; return data; })
      .catch(function (e) {
        console.warn('[cinema] failed to load presets:', e);
        presetCache = [];
        return presetCache;
      });
  }

  // ---- Cesium easing lookup -------------------------------------------------

  function getEasing(name) {
    var map = {
      'linear': Cesium.EasingFunction.LINEAR_NONE,
      'quadratic-in': Cesium.EasingFunction.QUADRATIC_IN,
      'quadratic-out': Cesium.EasingFunction.QUADRATIC_OUT,
      'cubic-in-out': Cesium.EasingFunction.CUBIC_IN_OUT,
    };
    return map[name] || Cesium.EasingFunction.CUBIC_IN_OUT;
  }

  // ---- Layer module lookup --------------------------------------------------

  var LAYER_MODULES = {
    earthquakes: function () { return typeof Earthquakes !== 'undefined' ? Earthquakes : null; },
    satellites:  function () { return typeof Satellites  !== 'undefined' ? Satellites  : null; },
    aircraft:    function () { return typeof Aircraft    !== 'undefined' ? Aircraft    : null; },
    bases:       function () { return typeof Bases       !== 'undefined' ? Bases       : null; },
    military:    function () { return typeof Military    !== 'undefined' ? Military    : null; },
    intel:       function () { return typeof Intel       !== 'undefined' ? Intel       : null; },
    vessels:     function () { return typeof Vessels     !== 'undefined' ? Vessels     : null; },
    traffic:     function () { return typeof Traffic     !== 'undefined' ? Traffic     : null; },
    conflicts:   function () { return typeof Conflicts   !== 'undefined' ? Conflicts   : null; },
    playback:    function () { return typeof Playback    !== 'undefined' ? Playback    : null; },
    antarctica:  function () { return typeof Antarctica  !== 'undefined' ? Antarctica  : null; },
  };

  // ---- Cinema entities (pins, markers) --------------------------------------

  var cinemaEntities = [];

  function clearCinemaEntities(viewer) {
    cinemaEntities.forEach(function (e) { viewer.entities.remove(e); });
    cinemaEntities.length = 0;
  }

  // ---- Command implementations ----------------------------------------------

  /** clear — return to neutral state. Remove pins, close dossier. */
  async function cmd_clear(cue) {
    var viewer = Globe.getViewer();
    clearCinemaEntities(viewer);
    if (typeof Dossier !== 'undefined') Dossier.close();
    Shaders.setMode('normal');

    var hold = parseInt(cue.params.hold || '0', 10);
    if (hold > 0) await sleep(hold);

    viewer.scene.requestRender();
    await doubleRaf();
    emitReady(cue.raw);
  }

  /**
   * flyTo — animated camera move to lat/lon/alt with orientation.
   *
   *   #cinema/flyTo/<lat>,<lon>,<alt>/heading:DEG/pitch:DEG/roll:DEG
   *     /duration:SEC/easing:NAME/hold:MS
   */
  async function cmd_flyTo(cue) {
    var viewer = Globe.getViewer();
    var coords = (cue.target || '').split(',').map(Number);
    if (coords.length < 3 || coords.some(isNaN)) {
      console.error('[cinema] flyTo: invalid coordinates:', cue.target);
      emitReady(cue.raw);
      return;
    }

    var lat = coords[0], lon = coords[1], alt = coords[2];
    var heading  = parseFloat(cue.params.heading  || '0');
    var pitch    = parseFloat(cue.params.pitch    || '-90');
    var roll     = parseFloat(cue.params.roll     || '0');
    var duration = parseFloat(cue.params.duration || '2.5');
    var hold     = parseInt(cue.params.hold || '0', 10);

    await flyToAsync(viewer, {
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
      orientation: {
        heading: Cesium.Math.toRadians(heading),
        pitch:   Cesium.Math.toRadians(pitch),
        roll:    Cesium.Math.toRadians(roll),
      },
      duration: duration,
      easingFunction: getEasing(cue.params.easing || 'cubic-in-out'),
    });

    await waitForTilesLoaded(viewer, 8000);
    if (hold > 0) await sleep(hold);

    viewer.scene.requestRender();
    await doubleRaf();
    emitReady(cue.raw);
  }

  /**
   * preset — fire a named camera preset from presets.json.
   *
   *   #cinema/preset/<preset_id>/duration:SEC/hold:MS
   */
  async function cmd_preset(cue) {
    var viewer = Globe.getViewer();
    var presets = await getPresets();
    var name = (cue.target || '').toLowerCase().replace(/-/g, '_');

    var preset = presets.find(function (p) {
      return p.id.replace(/-/g, '_') === name || p.id === cue.target;
    });

    if (!preset) {
      console.error('[cinema] preset: not found:', cue.target);
      emitReady(cue.raw);
      return;
    }

    var duration = parseFloat(cue.params.duration || '2.5');
    var hold     = parseInt(cue.params.hold || '0', 10);

    await flyToAsync(viewer, {
      destination: Cesium.Cartesian3.fromDegrees(preset.lon, preset.lat, preset.altitude),
      duration: duration,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });

    await waitForTilesLoaded(viewer, 8000);
    if (hold > 0) await sleep(hold);

    viewer.scene.requestRender();
    await doubleRaf();
    emitReady(cue.raw);
  }

  /**
   * kenburns — settle camera at a position for Remotion-side drift animation.
   * If target is lat,lon,alt, set camera there instantly. If from: param is
   * provided, use that instead.
   *
   *   #cinema/kenburns/<lat>,<lon>,<alt>/heading:DEG/pitch:DEG/hold:MS
   */
  async function cmd_kenburns(cue) {
    var viewer = Globe.getViewer();
    var coordStr = cue.params.from || cue.target;

    if (coordStr) {
      var coords = coordStr.split(',').map(Number);
      if (coords.length >= 3 && !coords.some(isNaN)) {
        var heading = parseFloat(cue.params.heading_from || cue.params.heading || '0');
        var pitch   = parseFloat(cue.params.pitch_from   || cue.params.pitch   || '-90');

        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(coords[1], coords[0], coords[2]),
          orientation: {
            heading: Cesium.Math.toRadians(heading),
            pitch:   Cesium.Math.toRadians(pitch),
            roll:    0,
          },
        });
      }
    }

    await waitForTilesLoaded(viewer, 8000);

    var hold = parseInt(cue.params.hold || '0', 10);
    if (hold > 0) await sleep(hold);

    viewer.scene.requestRender();
    await doubleRaf();
    emitReady(cue.raw);
  }

  /**
   * layers — set visible data layer mask.
   *
   *   #cinema/layers/<slug>,<slug>,...
   *   #cinema/layers/none
   */
  async function cmd_layers(cue) {
    var slugs = (cue.target || '').split(',').map(function (s) {
      return s.trim().toLowerCase();
    });
    var isNone = slugs.length === 1 && slugs[0] === 'none';

    Object.keys(LAYER_MODULES).forEach(function (id) {
      var mod = LAYER_MODULES[id]();
      if (!mod) return;
      var shouldShow = !isNone && slugs.indexOf(id) !== -1;
      if (mod.isVisible() !== shouldShow) mod.setVisible(shouldShow);
    });

    var viewer = Globe.getViewer();
    viewer.scene.requestRender();

    var hold = parseInt(cue.params.hold || '0', 10);
    if (hold > 0) await sleep(hold);

    await doubleRaf();
    emitReady(cue.raw);
  }

  /**
   * mode — visual mode switch.
   *
   *   #cinema/mode/<normal|crt|nvg|flir>/hold:MS
   */
  async function cmd_mode(cue) {
    var mode = (cue.target || 'normal').toLowerCase();
    Shaders.setMode(mode);

    var hold = parseInt(cue.params.hold || '0', 10);
    if (hold > 0) await sleep(hold);

    await doubleRaf();
    emitReady(cue.raw);
  }

  /**
   * base — base layer swap.
   *
   *   #cinema/base/<dark|satellite|terrain|osm|voyager>/hold:MS
   */
  async function cmd_base(cue) {
    var layerId = (cue.target || 'dark').toLowerCase();
    Globe.setBaseLayer(layerId);

    var viewer = Globe.getViewer();
    await waitForTilesLoaded(viewer, 8000);

    var hold = parseInt(cue.params.hold || '0', 10);
    if (hold > 0) await sleep(hold);

    viewer.scene.requestRender();
    await doubleRaf();
    emitReady(cue.raw);
  }

  /**
   * pin — drop an annotated pin at a location.
   *
   *   #cinema/pin/<lat>,<lon>/label:text/color:#hex/hold:MS
   */
  async function cmd_pin(cue) {
    var viewer = Globe.getViewer();
    var coords = (cue.target || '').split(',').map(Number);
    if (coords.length < 2 || coords.some(isNaN)) {
      console.error('[cinema] pin: invalid coordinates:', cue.target);
      emitReady(cue.raw);
      return;
    }

    var lat   = coords[0], lon = coords[1];
    var label = (cue.params.label || '').replace(/^"|"$/g, '');
    var color = cue.params.color || '#34d399';

    var entity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: {
        pixelSize: 12,
        color: Cesium.Color.fromCssColorString(color),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: label ? {
        text: label,
        font: '16px monospace',
        fillColor: Cesium.Color.fromCssColorString(color),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      } : undefined,
    });
    cinemaEntities.push(entity);

    viewer.scene.requestRender();

    var hold = parseInt(cue.params.hold || '0', 10);
    if (hold > 0) await sleep(hold);

    await doubleRaf();
    emitReady(cue.raw);
  }

  /**
   * pins — drop multiple pins. Coordinates semicolon-separated, labels in
   * a separate param also semicolon-separated (matched by position).
   *
   *   #cinema/pins/<lat1,lon1>;<lat2,lon2>/labels:Tehran;Isfahan/color:#hex/hold:MS
   */
  async function cmd_pins(cue) {
    var viewer = Globe.getViewer();
    var color  = cue.params.color || '#fbbf24';
    var labels = (cue.params.labels || '').split(';');
    var entries = (cue.target || '').split(';');

    entries.forEach(function (entry, idx) {
      var coords = entry.split(',').map(Number);
      if (coords.length < 2 || coords.some(isNaN)) return;
      var label = labels[idx] || '';

      var entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(coords[1], coords[0]),
        point: {
          pixelSize: 10,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: label ? {
          text: label,
          font: '14px monospace',
          fillColor: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        } : undefined,
      });
      cinemaEntities.push(entity);
    });

    viewer.scene.requestRender();

    var hold = parseInt(cue.params.hold || '0', 10);
    if (hold > 0) await sleep(hold);

    await doubleRaf();
    emitReady(cue.raw);
  }

  /**
   * tour — multi-stop flyTo sequence through named presets.
   *
   *   #cinema/tour/<preset1>,<preset2>,.../leg_duration:SEC/pause:SEC/hold:MS
   */
  async function cmd_tour(cue) {
    var viewer  = Globe.getViewer();
    var presets = await getPresets();
    var stops   = (cue.target || '').split(',');
    var legDur  = parseFloat(cue.params.leg_duration || '2.5');
    var pause   = parseFloat(cue.params.pause || '1.0');

    for (var i = 0; i < stops.length; i++) {
      var name = stops[i].trim().toLowerCase().replace(/-/g, '_');
      var preset = presets.find(function (p) {
        return p.id.replace(/-/g, '_') === name || p.id === stops[i].trim();
      });
      if (!preset) {
        console.warn('[cinema] tour: preset not found:', stops[i]);
        continue;
      }

      await flyToAsync(viewer, {
        destination: Cesium.Cartesian3.fromDegrees(preset.lon, preset.lat, preset.altitude),
        duration: legDur,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      });
      await waitForTilesLoaded(viewer, 6000);

      if (i < stops.length - 1 && pause > 0) {
        await sleep(pause * 1000);
      }
    }

    var hold = parseInt(cue.params.hold || '0', 10);
    if (hold > 0) await sleep(hold);

    viewer.scene.requestRender();
    await doubleRaf();
    emitReady(cue.raw);
  }

  /**
   * timeline — scrub the simulation clock.
   *
   *   #cinema/timeline/at:<iso8601>/play:true|false/speed:N/hold:MS
   */
  async function cmd_timeline(cue) {
    var viewer = Globe.getViewer();

    if (cue.params.at) {
      viewer.clock.currentTime = Cesium.JulianDate.fromIso8601(cue.params.at);
    }
    if (cue.params.play !== undefined) {
      viewer.clock.shouldAnimate = cue.params.play === 'true';
    }
    if (cue.params.speed) {
      viewer.clock.multiplier = parseFloat(cue.params.speed);
    }

    viewer.scene.requestRender();

    var hold = parseInt(cue.params.hold || '0', 10);
    if (hold > 0) await sleep(hold);

    await doubleRaf();
    emitReady(cue.raw);
  }

  // ---- Command registry -----------------------------------------------------

  var commands = {
    clear:    cmd_clear,
    flyTo:    cmd_flyTo,
    flyto:    cmd_flyTo,
    preset:   cmd_preset,
    kenburns: cmd_kenburns,
    layers:   cmd_layers,
    mode:     cmd_mode,
    base:     cmd_base,
    pin:      cmd_pin,
    pins:     cmd_pins,
    tour:     cmd_tour,
    timeline: cmd_timeline,
  };

  // ---- Cue dispatch ---------------------------------------------------------

  var fallbackTimer = null;

  function clearFallback() {
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  }

  function armFallback(cue) {
    clearFallback();
    fallbackTimer = setTimeout(function () {
      console.warn('[cinema] fallback timeout — emitting ready:', cue.raw);
      emitReady(cue.raw);
    }, FALLBACK_TIMEOUT_MS);
  }

  async function handleCue(cue) {
    if (!cue) return;
    var fn = commands[cue.command];
    if (!fn) {
      console.warn('[cinema] unknown command:', cue.command, '— emitting ready');
      emitReady(cue.raw);
      return;
    }
    armFallback(cue);
    try {
      await fn(cue);
    } catch (e) {
      console.error('[cinema] command error:', e);
      emitReady(cue.raw);
    } finally {
      clearFallback();
    }
  }

  function onHashChange() {
    var cue = parseCue(window.location.hash);
    if (cue) handleCue(cue);
  }

  // ---- Bootstrap ------------------------------------------------------------

  function injectStyles() {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/cinema.css?v=' + VERSION;
    document.head.appendChild(link);
  }

  async function init() {
    document.body.classList.add('cinema-mode');
    injectStyles();

    await waitForApp();

    var viewer = Globe.getViewer();

    // ---- Determinism invariants ----

    // Freeze clock — sun, shadows, atmosphere, satellites all pinned
    viewer.clock.shouldAnimate = false;

    // Force FXAA for clean frame output
    viewer.scene.postProcessStages.fxaa.enabled = true;

    // Lock resolution scale
    viewer.resolutionScale = 1;

    // ---- Short-circuit normal UI ----

    // Kill landing overlay (requires keypress to dismiss — blocks cinema)
    var landing = document.getElementById('landing-overlay');
    if (landing) { landing.style.display = 'none'; landing.classList.remove('visible'); }

    // Kill loading screen
    var loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) loadingScreen.style.display = 'none';

    // Disable HashState.update — cinema controls the hash exclusively.
    // Without this, camera.moveEnd rewrites the hash to camera coords.
    if (typeof HashState !== 'undefined') {
      HashState.update = function () {};
      HashState.copyUrl = function () {};
    }

    // Pre-fetch presets
    getPresets();

    // ---- Cue handling ----

    window.addEventListener('hashchange', onHashChange);

    // Process initial hash cue after a short settle
    if (window.location.hash.indexOf('#cinema/') === 0) {
      setTimeout(onHashChange, 100);
    }

    console.log('[cinema] ARGUS cinema mode ready');
  }

  // Public API for testing / Remotion driver
  window.CinemaMode = {
    version: VERSION,
    parseCue: parseCue,
    handleCue: handleCue,
    emitReady: emitReady,
    _commands: commands,
  };

  init();
})();
