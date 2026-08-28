# tools/sweep — theater / disaster sweep tooling

Workflow (see memory `worldview-intel-globe`, session 2026-08-28):

1. Research agents (Opus) write `inbox/<theater>.json` + `inbox/<theater>.md` (new events only, 13-key schema),
   `inbox/disasters.json` + `inbox/disasters.md`, `inbox/global-scan.md` (+ `candidate-<slug>.json`).
2. `python3 merge_sweep.py --check` → validate; `--apply [theater ...]` → append into `data/theaters/`.
3. `python3 validate_disasters.py --check|--apply` → `data/disasters.json`.
4. `node test_disasters.js` → exercises js/disasters.js headlessly against a GDACS fixture.
5. Serve the repo (`python3 -m http.server 8080`) and `node cdp_smoke.js http://127.0.0.1:8080/ 70000`
   → headless-Chrome boot check (console, exceptions, layer counters). Needs google-chrome.
6. `SWEEP_DATE=YYYY-MM-DD python3 build_briefing.py` → `~/argus-sweeps/<date>/briefing.html` for review.

`SWEEP_DIR` overrides the inbox location. `inbox/` is gitignored.
