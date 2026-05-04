// timeline.js — 7-day time scrubber + replay mode with variable speed

const Timeline = (() => {
  let bar = null;
  let slider = null;
  let playBtn = null;
  let dateLabel = null;
  let statusLabel = null;
  let speedLabel = null;
  let visible = false;
  let playing = false;
  let playInterval = null;
  let currentEpoch = null; // null = LIVE

  // Replay mode state
  let replayMode = false;
  let replayStart = null;
  let replayEnd = null;

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const ONE_HOUR_MS = 60 * 60 * 1000;

  // Speed presets
  const SPEED_PRESETS = [
    { label: '1x',  step: 1 * 60 * 1000,  tick: 200 },  // 1 min per tick @ 200ms
    { label: '5x',  step: 5 * 60 * 1000,  tick: 200 },  // 5 min per tick
    { label: '15x', step: 15 * 60 * 1000, tick: 200 },   // 15 min per tick
    { label: '60x', step: 60 * 60 * 1000, tick: 200 },   // 1 hour per tick
  ];
  let speedIndex = 0;

  function getPlayStep() { return SPEED_PRESETS[speedIndex].step; }
  function getPlayInterval() { return SPEED_PRESETS[speedIndex].tick; }

  function init() {
    buildDOM();
    attachListeners();
    updateDisplay();
  }

  function buildDOM() {
    bar = document.getElementById('timeline-bar');
    slider = document.getElementById('timeline-slider');
    playBtn = document.getElementById('timeline-play');
    dateLabel = document.getElementById('timeline-date');
    statusLabel = document.getElementById('timeline-status');
    speedLabel = document.getElementById('timeline-speed');

    // Set slider range: 7 days ago → now
    updateSliderRange();
  }

  function updateSliderRange() {
    if (replayMode && replayStart !== null && replayEnd !== null) {
      slider.min = replayStart;
      slider.max = replayEnd;
      slider.value = replayStart;
    } else {
      const now = Date.now();
      slider.min = now - SEVEN_DAYS_MS;
      slider.max = now;
      slider.value = now;
    }
  }

  function attachListeners() {
    slider.addEventListener('input', () => {
      const val = parseInt(slider.value);

      if (replayMode) {
        currentEpoch = val;
        stopPlay();
        broadcastTime();
        updateDisplay();
        return;
      }

      const now = Date.now();
      // If dragged to within 5 min of now, snap to LIVE
      if (now - val < 5 * 60 * 1000) {
        goLive();
      } else {
        currentEpoch = val;
        stopPlay();
        broadcastTime();
        updateDisplay();
      }
    });

    playBtn.addEventListener('click', togglePlay);

    // Speed buttons
    const slowBtn = document.getElementById('speed-down');
    const fastBtn = document.getElementById('speed-up');
    if (slowBtn) slowBtn.addEventListener('click', speedDown);
    if (fastBtn) fastBtn.addEventListener('click', speedUp);
  }

  function togglePlay() {
    if (playing) {
      stopPlay();
    } else {
      startPlay();
    }
  }

  function startPlay() {
    if (currentEpoch === null) {
      if (replayMode) {
        currentEpoch = replayStart;
      } else {
        currentEpoch = Date.now() - SEVEN_DAYS_MS;
      }
      slider.value = currentEpoch;
    }
    playing = true;
    playBtn.textContent = '\u23F8'; // pause icon
    playBtn.setAttribute('aria-label', 'Pause timeline');
    playInterval = setInterval(() => {
      currentEpoch += getPlayStep();

      const max = replayMode ? replayEnd : Date.now();
      if (currentEpoch >= max) {
        if (replayMode) {
          currentEpoch = max;
          slider.value = currentEpoch;
          broadcastTime();
          updateDisplay();
          stopPlay();
        } else {
          goLive();
        }
        return;
      }
      slider.value = currentEpoch;
      broadcastTime();
      updateDisplay();
    }, getPlayInterval());
  }

  function stopPlay() {
    playing = false;
    playBtn.textContent = '\u25B6'; // play icon
    playBtn.setAttribute('aria-label', 'Play timeline');
    if (playInterval) {
      clearInterval(playInterval);
      playInterval = null;
    }
  }

  function goLive() {
    stopPlay();
    currentEpoch = null;
    if (replayMode) exitReplayMode();
    updateSliderRange();
    broadcastTime();
    updateDisplay();
    updateTopBarLive(true);
  }

  // ── Replay Mode ────────────────────────────────────────────────────────

  function enterReplayMode(startMs, endMs) {
    replayMode = true;
    replayStart = startMs;
    replayEnd = endMs;
    speedIndex = 0;  // Reset to 1x
    updateSliderRange();
    currentEpoch = startMs;
    slider.value = startMs;
    broadcastTime();
    updateDisplay();
    // Auto-show timeline
    if (!visible) setVisible(true);
    console.log(`[Timeline] Replay mode: ${new Date(startMs).toISOString()} → ${new Date(endMs).toISOString()}`);
  }

  function exitReplayMode() {
    replayMode = false;
    replayStart = null;
    replayEnd = null;
    updateSliderRange();
  }

  function isInReplayMode() {
    return replayMode;
  }

  // ── Speed Control ──────────────────────────────────────────────────────

  function speedUp() {
    if (speedIndex < SPEED_PRESETS.length - 1) {
      speedIndex++;
      updateSpeedDisplay();
      // Restart play interval at new speed if playing
      if (playing) {
        stopPlay();
        startPlay();
      }
    }
  }

  function speedDown() {
    if (speedIndex > 0) {
      speedIndex--;
      updateSpeedDisplay();
      if (playing) {
        stopPlay();
        startPlay();
      }
    }
  }

  function updateSpeedDisplay() {
    if (speedLabel) speedLabel.textContent = SPEED_PRESETS[speedIndex].label;
  }

  // ── Broadcast ──────────────────────────────────────────────────────────

  function broadcastTime() {
    const epoch = currentEpoch;
    // Core layers
    if (typeof Earthquakes !== 'undefined' && Earthquakes.setTime) {
      Earthquakes.setTime(epoch);
    }
    if (typeof Satellites !== 'undefined' && Satellites.setTime) {
      Satellites.setTime(epoch);
    }
    if (typeof Conflicts !== 'undefined' && Conflicts.setTime) {
      Conflicts.setTime(epoch);
    }
    // New replay layers
    if (typeof Playback !== 'undefined' && Playback.setTime) {
      Playback.setTime(epoch || Date.now());
    }
    if (typeof SatCorrelation !== 'undefined' && SatCorrelation.setTime) {
      SatCorrelation.setTime(epoch || Date.now());
    }
    // Update top bar LIVE indicator
    updateTopBarLive(epoch === null);
  }

  function updateTopBarLive(isLive) {
    const liveEl = document.querySelector('#top-bar .live');
    if (liveEl) {
      if (isLive) {
        liveEl.textContent = 'LIVE';
        liveEl.style.color = '';
      } else {
        const d = new Date(currentEpoch);
        const prefix = replayMode ? 'REPLAY' : 'REPLAY';
        liveEl.textContent = prefix + ' ' + formatShortDate(d);
        liveEl.style.color = 'var(--quake-shallow)';
      }
    }
  }

  function updateDisplay() {
    if (currentEpoch === null) {
      dateLabel.textContent = 'NOW';
      statusLabel.textContent = 'LIVE';
      statusLabel.className = 'timeline-status live';
    } else {
      const d = new Date(currentEpoch);
      dateLabel.textContent = formatDate(d);
      statusLabel.textContent = replayMode ? 'CAPTURE' : 'REPLAY';
      statusLabel.className = 'timeline-status replay';
    }
    updateSpeedDisplay();

    // Update left label
    const leftLabel = bar ? bar.querySelector('.timeline-label-left') : null;
    if (leftLabel) {
      if (replayMode && replayStart) {
        const d = new Date(replayStart);
        leftLabel.textContent = formatShortDate(d);
      } else {
        leftLabel.textContent = '7d ago';
      }
    }
  }

  function formatDate(d) {
    const mon = d.toLocaleString('en', { month: 'short' });
    const day = d.getUTCDate();
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${mon} ${day} ${h}:${m} UTC`;
  }

  function formatShortDate(d) {
    const mon = d.toLocaleString('en', { month: 'short' });
    const day = d.getUTCDate();
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${mon} ${day} ${h}:${m}`;
  }

  // Public API
  function getTime() {
    return currentEpoch !== null ? currentEpoch : Date.now();
  }

  function isLive() {
    return currentEpoch === null;
  }

  function getSpeed() {
    return SPEED_PRESETS[speedIndex].label;
  }

  function setVisible(v) {
    visible = v;
    if (bar) bar.classList.toggle('hidden', !v);
    document.body.classList.toggle('timeline-open', v);
    // When hiding, reset to LIVE (only if not in replay mode)
    if (!v && currentEpoch !== null && !replayMode) {
      goLive();
    }
  }

  function isTimelineVisible() {
    return visible;
  }

  // Keyboard actions (called from controls.js)
  function stepBack() {
    if (currentEpoch === null) {
      currentEpoch = Date.now() - ONE_HOUR_MS;
    } else {
      const minVal = replayMode ? replayStart : Date.now() - SEVEN_DAYS_MS;
      currentEpoch = Math.max(currentEpoch - ONE_HOUR_MS, minVal);
    }
    stopPlay();
    slider.value = currentEpoch;
    broadcastTime();
    updateDisplay();
    if (!visible) setVisible(true);
  }

  function stepForward() {
    if (currentEpoch === null) return;
    currentEpoch = currentEpoch + ONE_HOUR_MS;
    const max = replayMode ? replayEnd : Date.now();
    if (currentEpoch >= max) {
      if (replayMode) {
        currentEpoch = max;
        slider.value = currentEpoch;
        broadcastTime();
        updateDisplay();
        stopPlay();
      } else {
        goLive();
      }
      return;
    }
    stopPlay();
    slider.value = currentEpoch;
    broadcastTime();
    updateDisplay();
  }

  function resetToLive() {
    goLive();
  }

  return {
    init, getTime, isLive, getSpeed, setVisible, isTimelineVisible,
    stepBack, stepForward, togglePlay, resetToLive,
    enterReplayMode, exitReplayMode, isInReplayMode,
    speedUp, speedDown,
  };
})();
