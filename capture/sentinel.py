#!/usr/bin/env python3
"""ARGUS Sentinel — anomaly-triggered capture daemon.

Monitors global signal sources, detects anomalies via rolling Z-scores,
and auto-triggers capture.py when significant events are happening.

Usage:
  python capture/sentinel.py              # run sentinel
  python capture/sentinel.py --dry-run    # monitor only, don't spawn captures
"""

import argparse
import asyncio
import math
import os
import signal
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import aiohttp

# ── Config ───────────────────────────────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAPTURE_DIR = os.path.join(BASE_DIR, "data", "captures")
CAPTURE_SCRIPT = os.path.join(BASE_DIR, "capture", "capture.py")
PREPROCESS_SCRIPT = os.path.join(BASE_DIR, "capture", "preprocess.py")

TICK_INTERVAL = 5  # seconds between main loop ticks

SIGNALS = {
    "mil_flights": {
        "url": "https://api.adsb.lol/v2/mil",
        "interval": 60,
        "type": "json",
    },
    "earthquakes": {
        "url": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson",
        "interval": 120,
        "type": "json",
    },
    "news_velocity": {
        "url": "https://news.google.com/rss/search?q=military+attack+crisis&hl=en-US&gl=US&ceid=US:en",
        "interval": 180,
        "type": "rss",
    },
    "wikipedia_edits": {
        "url": "https://en.wikipedia.org/w/api.php?action=query&list=recentchanges&rclimit=500&rctype=edit&format=json",
        "interval": 120,
        "type": "json",
    },
}

# Thresholds
Z_CRITICAL = 3.0       # single signal triggers capture
Z_ELEVATED = 2.0       # 2+ elevated signals trigger capture
Z_COOLDOWN = 1.5       # all below this for COOLDOWN_MINUTES → stop capture
COOLDOWN_MINUTES = 10  # consecutive minutes below Z_COOLDOWN to stop
WARMUP_SAMPLES = 30    # samples before triggering enabled
WARMUP_REQUIRED = 3    # of 4 signals must be warmed up
MAX_CAPTURE_HOURS = 4  # force-stop captures running longer than this

# ── Baseline (Welford's Online Algorithm) ────────────────────────────────────

class Baseline:
    """Tracks running mean + variance with O(1) memory via Welford's algorithm."""

    def __init__(self):
        self.n = 0
        self.mean = 0.0
        self.m2 = 0.0

    @property
    def stddev(self):
        if self.n < 2:
            return 0.0
        return max(math.sqrt(self.m2 / self.n), 1.0)  # floor at 1.0

    @property
    def warmed(self):
        return self.n >= WARMUP_SAMPLES

    def update(self, value):
        self.n += 1
        delta = value - self.mean
        self.mean += delta / self.n
        delta2 = value - self.mean
        self.m2 += delta * delta2

    def z_score(self, value):
        if self.n < 2:
            return 0.0
        return (value - self.mean) / self.stddev

# ── Signal Extractors ────────────────────────────────────────────────────────

def extract_mil_flights(data):
    """Count of military aircraft from adsb.lol."""
    ac = data.get("ac") or []
    return len(ac)

def extract_earthquakes(data):
    """Count of M4.5+ earthquakes in the last hour."""
    features = data.get("features") or []
    return len(features)

def extract_news_velocity(text):
    """Count of items in Google News RSS feed."""
    try:
        root = ET.fromstring(text)
        return len(root.findall(".//item"))
    except ET.ParseError:
        return 0

def extract_wikipedia_edits(data):
    """Count of recent edits from Wikipedia API."""
    query = data.get("query") or {}
    changes = query.get("recentchanges") or []
    return len(changes)

EXTRACTORS = {
    "mil_flights": extract_mil_flights,
    "earthquakes": extract_earthquakes,
    "news_velocity": extract_news_velocity,
    "wikipedia_edits": extract_wikipedia_edits,
}

# ── Capture Manager ─────────────────────────────────────────────────────────

class CaptureManager:
    """Manages capture.py subprocess lifecycle."""

    def __init__(self, dry_run=False):
        self.dry_run = dry_run
        self.process = None
        self.slug = None
        self.db_path = None
        self.start_time = None

    @property
    def active(self):
        return self.process is not None and self.process.returncode is None

    @property
    def runtime_hours(self):
        if self.start_time is None:
            return 0.0
        return (time.time() - self.start_time) / 3600

    def make_slug(self, reason):
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
        tag = reason.lower().replace(" ", "-").replace("_", "-")[:40]
        return f"{ts}-{tag}"

    async def start(self, reason):
        if self.active:
            return
        self.slug = self.make_slug(reason)
        self.db_path = os.path.join(CAPTURE_DIR, f"{self.slug}.db")
        os.makedirs(CAPTURE_DIR, exist_ok=True)

        log(f"CAPTURE START: {self.slug}")
        log(f"  reason: {reason}")
        log(f"  db: {self.db_path}")

        if self.dry_run:
            log("  [dry-run] skipping subprocess spawn")
            return

        self.process = await asyncio.create_subprocess_exec(
            sys.executable, CAPTURE_SCRIPT,
            "--db", self.db_path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        self.start_time = time.time()
        log(f"  pid: {self.process.pid}")

    async def stop(self):
        if not self.active:
            return
        log(f"CAPTURE STOP: {self.slug} (ran {self.runtime_hours:.1f}h)")

        self.process.send_signal(signal.SIGTERM)
        try:
            _, stderr = await asyncio.wait_for(self.process.communicate(), timeout=30)
            if stderr:
                log(f"  capture stderr: {stderr.decode(errors='replace')[-200:]}")
        except asyncio.TimeoutError:
            log("  capture didn't exit in 30s, killing")
            self.process.kill()
            await self.process.wait()

        await self._preprocess()
        self.process = None
        self.slug = None
        self.db_path = None
        self.start_time = None

    async def _preprocess(self):
        if self.dry_run or not self.db_path or not os.path.exists(self.db_path):
            return
        log(f"PREPROCESS: {self.slug}")
        proc = await asyncio.create_subprocess_exec(
            sys.executable, PREPROCESS_SCRIPT,
            self.db_path,
            "--slug", self.slug,
            "--title", self.slug.replace("-", " ").title(),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)
        if proc.returncode != 0:
            log(f"  preprocess failed (rc={proc.returncode}): {stderr.decode(errors='replace')[-200:]}")
        else:
            log(f"  preprocess done")

# ── Utilities ────────────────────────────────────────────────────────────────

def log(msg):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[sentinel {ts}] {msg}", flush=True)

# ── Main Loop ────────────────────────────────────────────────────────────────

shutdown_event = None  # set in run()

async def run(dry_run=False):
    global shutdown_event
    shutdown_event = asyncio.Event()
    baselines = {name: Baseline() for name in SIGNALS}
    last_poll = {name: 0.0 for name in SIGNALS}
    last_z = {name: 0.0 for name in SIGNALS}
    cooldown_start = None
    manager = CaptureManager(dry_run=dry_run)

    log(f"sentinel started (dry_run={dry_run})")
    log(f"signals: {', '.join(SIGNALS.keys())}")
    log(f"thresholds: critical={Z_CRITICAL} elevated={Z_ELEVATED} cooldown={Z_COOLDOWN}")

    headers = {"User-Agent": "ARGUSSentinel/1.0", "Accept": "application/json"}
    async with aiohttp.ClientSession(
        timeout=aiohttp.ClientTimeout(total=20), headers=headers
    ) as session:
        while True:
            now = time.time()

            # Poll each signal if its interval has elapsed
            for name, cfg in SIGNALS.items():
                if now - last_poll[name] < cfg["interval"]:
                    continue
                last_poll[name] = now

                try:
                    async with session.get(cfg["url"]) as resp:
                        if cfg["type"] == "rss":
                            text = await resp.text()
                            value = EXTRACTORS[name](text)
                        else:
                            data = await resp.json(content_type=None)
                            value = EXTRACTORS[name](data)

                    bl = baselines[name]
                    bl.update(value)
                    z = bl.z_score(value)
                    last_z[name] = z

                    status = ""
                    if bl.warmed:
                        if z >= Z_CRITICAL:
                            status = " *** CRITICAL ***"
                        elif z >= Z_ELEVATED:
                            status = " ** ELEVATED **"

                    log(f"  {name}: value={value} mean={bl.mean:.1f} std={bl.stddev:.1f} "
                        f"z={z:+.2f} (n={bl.n}){status}")

                except Exception as e:
                    log(f"  {name}: ERROR {e}")

            # Check warmup gate
            warmed_count = sum(1 for bl in baselines.values() if bl.warmed)
            warmed_ok = warmed_count >= WARMUP_REQUIRED

            if not warmed_ok:
                try:
                    await asyncio.wait_for(shutdown_event.wait(), timeout=TICK_INTERVAL)
                    break
                except asyncio.TimeoutError:
                    continue

            # Evaluate trigger / cooldown
            critical = [n for n in SIGNALS if last_z[n] >= Z_CRITICAL]
            elevated = [n for n in SIGNALS if last_z[n] >= Z_ELEVATED]
            all_cool = all(last_z[n] < Z_COOLDOWN for n in SIGNALS)

            # Force-stop stale captures
            if manager.active and manager.runtime_hours >= MAX_CAPTURE_HOURS:
                log(f"FORCE STOP: capture exceeded {MAX_CAPTURE_HOURS}h")
                await manager.stop()

            # Trigger capture
            if not manager.active:
                trigger_reason = None
                if critical:
                    trigger_reason = f"{critical[0]}-critical"
                elif len(elevated) >= 2:
                    trigger_reason = f"convergence-{'+'.join(elevated)}"

                if trigger_reason:
                    cooldown_start = None
                    await manager.start(trigger_reason)

            # Cooldown evaluation
            if manager.active:
                if all_cool:
                    if cooldown_start is None:
                        cooldown_start = time.time()
                        log(f"cooldown started (need {COOLDOWN_MINUTES}m below z={Z_COOLDOWN})")
                    elif time.time() - cooldown_start >= COOLDOWN_MINUTES * 60:
                        log("cooldown complete — stopping capture")
                        await manager.stop()
                        cooldown_start = None
                else:
                    if cooldown_start is not None:
                        log("cooldown reset — signal elevated again")
                        cooldown_start = None

            try:
                await asyncio.wait_for(shutdown_event.wait(), timeout=TICK_INTERVAL)
                break
            except asyncio.TimeoutError:
                pass

    # Clean shutdown: stop active capture + preprocess
    if manager.active:
        log("stopping active capture before exit")
        await manager.stop()

# ── Entry Point ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="ARGUS Sentinel — anomaly-triggered capture")
    parser.add_argument("--dry-run", action="store_true",
                        help="Monitor signals but don't spawn captures")
    args = parser.parse_args()

    def shutdown(sig, _):
        log(f"received {signal.Signals(sig).name}, shutting down")
        shutdown_event.set()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    try:
        asyncio.run(run(dry_run=args.dry_run))
    except KeyboardInterrupt:
        pass
    finally:
        log("sentinel stopped")

if __name__ == "__main__":
    main()
