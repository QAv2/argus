# ARGUS — Cinema Mode Spec

Cinema Mode is the deterministic, URL-driven rendering surface for programmatic
video capture of the 3D globe. Cue grammar and readiness protocol are identical
to the Intel Console spec so a single Remotion driver can talk to both surfaces.

See `~/intel-console/CINEMA_MODE.md` for the shared conventions. This document
covers only the ARGUS-specific commands and the Cesium-specific invariants.

## Activation

`?cinema=1` in the query string enables cinema mode. Implicit side effects when
set:

- `chrome=off` — hide all UI overlays (list below)
- `clock=frozen` — `viewer.clock.shouldAnimate = false`, fix `currentTime` to
  a canonical instant so sun position, atmospheric scattering, and any moving
  entities (satellites, aircraft, vessels) are stationary unless a cue opts in
- `labels=off` — hide globe labels by default (cues can re-enable)
- `fxaa=on` — force anti-aliasing on for clean frame output
- `depth_test=on` — force depth testing against terrain for stable occlusion
- `share_btn=off` — hide the SHARE button (otherwise it writes to hash and
  clobbers cinema's own hash grammar)

Optional overrides:

| Param           | Default      | Effect                                       |
|-----------------|--------------|----------------------------------------------|
| `clock=<iso8601>` | canonical  | Pin simulation time to an explicit instant   |
| `clock=live`    | —            | Let the clock run (for live-motion cues only) |
| `fog=off`       | on           | Disable atmospheric fog                      |
| `stars=off`     | on           | Disable starfield (for transparent composite) |

## Cue Grammar

Shared form: `#cinema/<command>/<target>[/<key>:<value>]...`

### `flyTo` — animated camera move to a lat/lon/alt/orientation

```
#cinema/flyTo/<lat>,<lon>,<alt>
  /heading:DEG
  /pitch:DEG
  /roll:DEG
  /duration:SEC
  /easing:NAME
  /hold:MS
```

| Key       | Default | Meaning                                         |
|-----------|---------|-------------------------------------------------|
| heading   | `0`     | Degrees, 0 = north                              |
| pitch     | `-90`   | Degrees, -90 = look straight down               |
| roll      | `0`     | Degrees                                         |
| duration  | `2.5`   | Cesium flyTo duration in seconds                |
| easing    | `cubic-in-out` | `linear`, `quadratic-in`, `quadratic-out`, `cubic-in-out` (Cesium built-in easings) |
| hold      | `0`     | Extra settle ms after arrival before ready      |

Readiness fires in the Cesium `camera.flyTo({ complete })` callback plus the
`hold` delay plus two rAF ticks.

Example — establishing shot over Iran theater:

```
#cinema/flyTo/32.4279,53.6880,2500000/heading:0/pitch:-60/duration:4.0
```

### `preset` — fire a named camera preset

```
#cinema/preset/<preset_name>/duration:SEC/hold:MS
```

Presets already defined in ARGUS (bound to keyboard shortcuts) — cinema
mode reuses the same lookup table so names stay in sync with the landing card:

| Name           | Description            |
|----------------|------------------------|
| `us_overview`  | Continental US (Q)     |
| `dulce`        | Dulce complex (W)      |
| `area_51`      | Groom Lake (E)         |
| `denver`       | DIA (R)                |
| `pine_gap`     | Pine Gap (Y)           |
| `global`       | Whole-earth view (G)   |
| `cog_network`  | COG sites (C)          |
| `nm_corridor`  | New Mexico corridor (N) |
| `iran_theater` | Iran operations (I)    |
| `antarctica`   | Antarctica (P)         |

New presets can be added by extending the existing preset registry in
`controls.js` — no cinema-mode change needed.

### `pin` — drop an annotated pin at a location

```
#cinema/pin/<lat>,<lon>
  /label:"Martinsburg, WV"
  /color:#34d399
  /style:dot|crosshair|target|chevron
  /persist:Ns
  /hold:MS
```

Renders a Cesium billboard with an HTML label overlay (styled to match the
disclosure-scrolls aesthetic). `persist` keeps the pin visible for N seconds or
`forever` — useful when the narration references the location twice and you
want the pin to stick through an intervening `flyTo`.

### `pins` — drop multiple pins in one cue (for map-markup beats)

```
#cinema/pins/<lat1,lon1:label1>,<lat2,lon2:label2>,.../color:#fbbf24/hold:MS
```

### `tour` — multi-stop animated flyTo sequence

```
#cinema/tour/<preset1>,<preset2>,<preset3>/leg_duration:SEC/pause:SEC
```

Chains flyTos with pauses between legs. Readiness fires after the final pause
of the final leg. Useful for the "7 countries" beat in Money Wars (Iraq, Libya,
Venezuela, Cuba, etc).

### `layers` — set visible data layer mask

```
#cinema/layers/<slug>,<slug>,<slug>
```

Accepts the same layer slugs used in `hashstate.js` (earthquakes, satellites,
aircraft, bases, military, intel, vessels, traffic, conflicts, playback,
jamming, airspace, antarctica). Unlisted layers are hidden. Pass `none` for
empty layer state.

### `mode` — visual mode switch

```
#cinema/mode/<normal|crt|nvg|flir>
```

Matches `Shaders.setMode()`. Useful for Act 4 color shifts in the pilot — the
AI Wars scroll goes green-to-amber at the "War for Mind" reveal, and the video
can fire `#cinema/mode/nvg` at the same beat for a unified visual language.

### `base` — base layer swap

```
#cinema/base/<base_layer_id>
```

Matches `Globe.setBaseLayer()` — dark, satellite, terrain, OSM, Voyager,
Google3D. Pre-warmed during cinema init so the swap is instant.

### `marker` — focus on a specific data-layer marker

```
#cinema/marker/<layer>:<id>/frame:close|medium|wide/hold:MS
```

Examples:

```
#cinema/marker/bases:dulce/frame:close
#cinema/marker/conflicts:2026-iran-strike-001/frame:medium
```

Internally: look up the marker via the layer module's existing getter, read
its position, call `viewer.camera.flyToBoundingSphere()` framed at the
specified distance. Opens the dossier panel for that marker after arrival if
`dossier=on` is also set.

### `timeline` — scrub the playback clock

```
#cinema/timeline/at:<iso8601>/play:true|false/speed:N
```

For Sky Wars / conflict-timeline beats where the cue needs to show data at a
specific historical moment. Implicitly unfreezes the clock.

### `clear` — return to neutral (no pins, close dossier, normal mode)

```
#cinema/clear/hold:MS
```

### `kenburns` — slow drift over a static framing

```
#cinema/kenburns/from:<lat,lon,alt>/to:<lat,lon,alt>
  /heading_from:DEG/heading_to:DEG
  /pitch_from:DEG/pitch_to:DEG
  /duration:SEC
  /easing:NAME
```

Straight linear interpolation of camera state over the duration. Default shot
for holds where the narration has more to say than a static view can carry.

## Readiness Protocol

Identical shape to Intel Console:

```js
window.parent.postMessage({
  type: 'cinema:ready',
  cue: location.hash,
  timestamp: performance.now(),
}, '*');
```

### Readiness checklist (ARGUS-specific additions)

1. `viewer.camera.flyTo()` `complete` callback fired (if a flyTo was issued)
2. `viewer.scene.globe.tilesLoaded === true` — all terrain tiles in view have
   finished loading (critical for satellite/3D-tiles base layers where
   progressive loading can emit blurry initial frames)
3. All pinned billboards are `ready` (texture loaded)
4. `viewer.scene.preRender` has fired twice after all above (so atmospheric
   scattering is stable against the current camera)
5. Any `hold:MS` timer has elapsed

Without the `tilesLoaded` gate, cinema output shows low-res tiles popping to
high-res mid-shot. This is the single biggest Cesium recording artifact.

## Determinism Invariants

- **Clock frozen by default.** Sun, moon, shadows, atmosphere, satellites —
  all pinned to the canonical instant unless `clock=live` is set.
- **No real-time data during cinema.** Earthquakes, aircraft (ADS-B), vessels
  (AIS), conflicts — all cached feeds. Cinema init loads the most recent
  snapshot at build time and never refreshes.
- **Tile provider pinned.** Base layers that fetch from live CDNs (satellite
  imagery, OSM, CartoDB) must resolve to the same tile revision across
  runs. If the CDN versions tiles, cache the response on first fetch.
- **FXAA always on.** Default ARGUS toggles FXAA; cinema mode forces on.
- **Resolution fixed.** Canvas is locked to the Remotion composition
  resolution (1920×1080) regardless of viewport. `viewer.resolutionScale = 1`
  explicit.

## Chrome Hide List (when `chrome=off`)

Hide: `#loading-screen`, `#top-bar`, `#toggle-panel-btn`, `#side-panel`,
`#dossier-panel` (unless a cue opens it), `#coords`, `#mode-indicator`,
`#timeline-bar`, `#stats-bar`, `#landing-overlay`, `#help-overlay`,
`#crosshair`, `#shader-overlay .fx-rollbar` (the CRT rollbar animation —
replaced by `mode` cues).

Keep: `#cesiumContainer`.

## Implementation Plan

1. **New file: `js/cinema.js`** — loaded by `index.html` with `defer`. Module
   checks `URLSearchParams.get('cinema')` and runs nothing if not set. Normal
   users pay zero cost. Load order: must come after `globe.js`, `shaders.js`,
   `controls.js`, `dossier.js`, and `hashstate.js`, because it calls into all
   of them. Insert before `app.js` so cinema can short-circuit app init.
2. **New file: `css/cinema.css`** — conditionally injected by `cinema.js` via
   a dynamic `<link>` tag. Contains `.cinema-mode` body class rules hiding the
   chrome list and pinning the canvas to 1920×1080.
3. **Hashchange handler** — cinema mode adds its own `hashchange` listener,
   intercepts `#cinema/...` fragments, and prevents `hashstate.js` from
   consuming them. Non-cinema URLs still flow through `hashstate.js` normally.
4. **Preset registry refactor** — the existing camera presets are currently
   bound directly to key handlers in `controls.js`. Extract the
   name-to-`flyTo` args mapping into a plain object so cinema's `preset` cue
   can look them up. Cost: ~15 lines refactor, no semantic change.
5. **Test harness** — new `cinema-test.html` with buttons for each cue type,
   used to verify behavior before Remotion integration. Mirror of the Intel
   Console harness.

## Open Questions

- **ADS-B / AIS feeds.** Current ARGUS fetches live feeds. Cinema mode
  needs a snapshot. Simplest path: cinema init saves the first-fetch response
  to `localStorage` and replays it. Verify this is acceptable or if we need a
  committed snapshot file.
- **Share button interception.** The SHARE button writes to `location.hash`
  on click — cinema mode hides the button but we should also disable its
  event handler to be safe.

Deferred to the build phase.
