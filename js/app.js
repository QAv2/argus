// app.js — Boot sequence + state management

const App = (() => {
  const loadingScreen = document.getElementById('loading-screen');
  const loadingStatus = document.getElementById('loading-status');
  const loadingBar = document.getElementById('loading-bar-fill');
  const landingOverlay = document.getElementById('landing-overlay');

  async function boot() {
    try {
      // Parse hash state before anything else
      const hashState = HashState.parse();

      // Phase 1 — sequential core init
      setProgress('INITIALIZING CORE...', 10);
      const viewer = Globe.init();

      // Apply camera from hash (overrides default US view)
      if (hashState) HashState.applyCamera(hashState);

      setProgress('INITIALIZING CORE...', 20);
      Shaders.init();
      setProgress('INITIALIZING CORE...', 25);
      Dossier.init();

      // Phase 2 — parallel data layer loading
      setProgress('LOADING DATA LAYERS...', 30);
      const t0 = performance.now();
      const results = await Promise.allSettled([
        Bases.init(viewer),
        Intel.init(viewer),
        Earthquakes.init(viewer),
        Satellites.init(viewer),
        Aircraft.init(viewer),
        Military.init(viewer),
        Vessels.init(viewer),
        Traffic.init(viewer),
        Conflicts.init(viewer),
        Playback.init(viewer),
        Antarctica.init(viewer),
        SatCorrelation.init(viewer),
      ]);
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      console.log(`[WorldView] Data layers loaded in ${elapsed}s`);

      // Log any failures
      const layerNames = [
        'Bases', 'Intel', 'Earthquakes', 'Satellites', 'Aircraft', 'Military',
        'Vessels', 'Traffic', 'Conflicts', 'Playback', 'Antarctica', 'SatCorrelation',
      ];
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.warn(`[WorldView] ${layerNames[i]} failed:`, r.reason);
        }
      });

      setProgress('LOADING DATA LAYERS...', 90);

      // Phase 3 — controls (depends on layers being ready)
      setProgress('INITIALIZING CONTROLS...', 95);
      await Controls.init();
      Timeline.init();

      // Apply hash state after everything is initialized
      if (hashState) {
        HashState.applySettings(hashState);
        HashState.applyLayers(hashState);
      }

      // Start hash state tracking
      HashState.init();

      setProgress('SYSTEMS ONLINE', 100);

      // Start periodic updates
      setInterval(() => Controls.updateCounts(), 5000);
      Controls.updateCounts();

      // Dismiss loading screen, then show landing overlay
      setTimeout(() => {
        loadingScreen.classList.add('done');
        setTimeout(() => {
          loadingScreen.style.display = 'none';
          showLanding();
        }, 500);
      }, 800);

      console.log('[WorldView] All systems online');

    } catch (err) {
      console.error('[WorldView] Boot failed:', err);
      loadingStatus.textContent = 'ERROR: ' + err.message;
      loadingStatus.style.color = '#f87171';
    }
  }

  function showLanding() {
    // Draw vessel type icons on canvases
    drawLandingIcons();

    landingOverlay.classList.add('visible');

    const dismiss = (e) => {
      // Don't dismiss on scrolling inside the card
      if (e.type === 'wheel') return;
      landingOverlay.classList.add('dismissing');
      landingOverlay.classList.remove('visible');
      setTimeout(() => { landingOverlay.style.display = 'none'; }, 400);
      document.removeEventListener('keydown', dismiss);
      landingOverlay.removeEventListener('click', dismiss);
    };

    document.addEventListener('keydown', dismiss);
    landingOverlay.addEventListener('click', dismiss);
  }

  function drawLandingIcons() {
    const canvases = document.querySelectorAll('.landing-icon');
    canvases.forEach(canvas => {
      const shape = canvas.dataset.shape;
      const color = canvas.dataset.color;
      const ctx = canvas.getContext('2d');
      const s = 16;
      const cx = s / 2;
      const cy = s / 2;
      const r = s / 2 - 2;

      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 0.5;

      switch (shape) {
        case 'diamond':
          ctx.beginPath();
          ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy);
          ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
          ctx.closePath(); ctx.fill(); ctx.stroke();
          break;
        case 'pentagon':
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + (i * 2 * Math.PI / 5);
            const px = cx + r * Math.cos(a);
            const py = cy + r * Math.sin(a);
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.closePath(); ctx.fill(); ctx.stroke();
          break;
        case 'circle':
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
          break;
        case 'plus': {
          const w = 3;
          ctx.beginPath();
          ctx.moveTo(cx - w / 2, cy - r); ctx.lineTo(cx + w / 2, cy - r);
          ctx.lineTo(cx + w / 2, cy - w / 2); ctx.lineTo(cx + r, cy - w / 2);
          ctx.lineTo(cx + r, cy + w / 2); ctx.lineTo(cx + w / 2, cy + w / 2);
          ctx.lineTo(cx + w / 2, cy + r); ctx.lineTo(cx - w / 2, cy + r);
          ctx.lineTo(cx - w / 2, cy + w / 2); ctx.lineTo(cx - r, cy + w / 2);
          ctx.lineTo(cx - r, cy - w / 2); ctx.lineTo(cx - w / 2, cy - w / 2);
          ctx.closePath(); ctx.fill(); ctx.stroke();
          break;
        }
        case 'triangle':
          ctx.beginPath();
          ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.9, cy + r * 0.7);
          ctx.lineTo(cx - r * 0.9, cy + r * 0.7);
          ctx.closePath(); ctx.fill(); ctx.stroke();
          break;
        case 'medical':
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#ffffff';
          const cw = 2.5;
          const cr = r - 3;
          ctx.fillRect(cx - cw / 2, cy - cr, cw, cr * 2);
          ctx.fillRect(cx - cr, cy - cw / 2, cr * 2, cw);
          break;
        default: // dot
          ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
          ctx.fill(); ctx.stroke();
          break;
      }
    });
  }

  function setProgress(msg, pct) {
    loadingStatus.textContent = msg;
    loadingBar.style.width = pct + '%';
    console.log(`[WorldView] ${msg}`);
  }

  // Boot on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return { boot };
})();
