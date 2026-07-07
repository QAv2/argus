#!/usr/bin/env python3
"""ARGUS Pre-processor — crunches capture SQLite → playback JSON frames.

Usage:
  python capture/preprocess.py data/captures/event.db --slug iran-strike-2026-03-01
  python capture/preprocess.py data/captures/event.db --slug test --title "Test Capture"
"""

import argparse
import json
import os
import sqlite3
from datetime import datetime, timezone


# ── Config ──────────────────────────────────────────────────────────────────

FRAME_INTERVAL_S = 60      # 1 frame per minute
REPLAY_DIR = "data/replays"

# Military identification: db_flags bit 0 = military, or squawk 7x00 patterns
MIL_SQUAWKS = {"7501", "7502", "7600", "7700"}


def is_military(hex_code, db_flags, squawk, category):
    """Heuristic: is this aircraft military?"""
    if db_flags and (db_flags & 1):
        return True
    if squawk in MIL_SQUAWKS:
        return True
    if category and category.startswith("A") and category >= "A5":
        return True  # Heavy aircraft categories
    return False


# ── Frame Generation ────────────────────────────────────────────────────────

def generate_frames(db, slug, start_ts, end_ts, out_dir):
    """Generate per-minute frame JSON."""
    frames_dir = os.path.join(out_dir, "frames")
    os.makedirs(frames_dir, exist_ok=True)

    frame_count = 0
    ts = start_ts

    while ts <= end_ts:
        # Window: ts - 30s to ts + 30s (snap to nearest snapshot)
        window_start = ts - 30
        window_end = ts + 30

        # Aircraft for this frame
        ac_rows = db.execute(
            """SELECT hex, flight, lat, lon, alt_baro, gs, track, nic, nac_p, sil, category, db_flags, squawk
               FROM aircraft_snapshots
               WHERE ts BETWEEN ? AND ?
               GROUP BY hex
               HAVING ts = MAX(ts)""",
            (window_start, window_end),
        ).fetchall()

        # Vessels for this frame
        vessel_rows = db.execute(
            """SELECT mmsi, name, lat, lon, speed, course, heading, ship_type, status
               FROM ais_snapshots
               WHERE ts BETWEEN ? AND ?
               GROUP BY mmsi
               HAVING ts = MAX(ts)""",
            (window_start, window_end),
        ).fetchall()

        # Build frame JSON (compact array-of-arrays)
        ac_list = []
        for r in ac_rows:
            hex_code, flight, lat, lon, alt, gs, track, nic, nac_p, sil, cat, db_flags, squawk = r
            mil = 1 if is_military(hex_code, db_flags, squawk, cat) else 0
            ac_list.append([
                round(lon, 4),
                round(lat, 4),
                alt or 0,
                mil,
                nic if nic is not None else -1,
            ])

        vessel_list = []
        for r in vessel_rows:
            mmsi, name, lat, lon, speed, course, heading, ship_type, status = r
            vessel_list.append([
                round(lon, 4),
                round(lat, 4),
                ship_type or 0,
                round(speed, 1) if speed else 0,
                mmsi[:4] if mmsi else "",
            ])

        frame = {
            "t": ts * 1000,  # epoch ms
            "ac": ac_list,
            "vessels": vessel_list,
        }

        frame_file = os.path.join(frames_dir, f"{frame_count:06d}.json")
        with open(frame_file, "w") as f:
            json.dump(frame, f, separators=(",", ":"))

        frame_count += 1
        ts += FRAME_INTERVAL_S

        if frame_count % 60 == 0:
            print(f"  frame {frame_count}...")

    return frame_count


# ── Manifest ────────────────────────────────────────────────────────────────

def build_manifest(slug, title, start_ts, end_ts, frame_count):
    """Build the replay manifest."""
    return {
        "slug": slug,
        "title": title or slug.replace("-", " ").title(),
        "start_ms": start_ts * 1000,
        "end_ms": end_ts * 1000,
        "frame_count": frame_count,
        "frame_interval_min": FRAME_INTERVAL_S // 60,
        "correlation_passes": [],  # Populated manually or by sat correlation tool
    }


def update_index(replay_dir, slug, manifest):
    """Update data/replays/index.json with this replay."""
    index_path = os.path.join(replay_dir, "index.json")
    if os.path.exists(index_path):
        with open(index_path) as f:
            index = json.load(f)
    else:
        index = {"replays": []}

    # Remove existing entry for this slug
    index["replays"] = [r for r in index["replays"] if r["slug"] != slug]

    # Add new entry
    index["replays"].append({
        "slug": slug,
        "title": manifest["title"],
        "start_ms": manifest["start_ms"],
        "end_ms": manifest["end_ms"],
        "frame_count": manifest["frame_count"],
    })

    with open(index_path, "w") as f:
        json.dump(index, f, indent=2)

    print(f"  Updated {index_path}")


# ── Main ────────────────────────────────────────────────────────────────────

def main(db_path, slug, title):
    if not os.path.exists(db_path):
        print(f"[preprocess] Database not found: {db_path}")
        return

    db = sqlite3.connect(db_path)
    db.row_factory = None

    # Determine time range from data
    row = db.execute("SELECT MIN(ts), MAX(ts) FROM aircraft_snapshots").fetchone()
    if not row or row[0] is None:
        print("[preprocess] No aircraft data found in database")
        db.close()
        return

    start_ts, end_ts = row
    duration_min = (end_ts - start_ts) / 60
    print(f"[preprocess] Time range: {datetime.fromtimestamp(start_ts, tz=timezone.utc)} → "
          f"{datetime.fromtimestamp(end_ts, tz=timezone.utc)} ({duration_min:.0f} min)")

    # Count data
    ac_count = db.execute("SELECT COUNT(*) FROM aircraft_snapshots").fetchone()[0]
    ais_count = db.execute("SELECT COUNT(*) FROM ais_snapshots").fetchone()[0]
    print(f"[preprocess] Data: {ac_count} aircraft rows, {ais_count} vessel rows")

    # Create output directory
    out_dir = os.path.join(REPLAY_DIR, slug)
    os.makedirs(out_dir, exist_ok=True)

    # Generate frames
    print(f"[preprocess] Generating frames...")
    frame_count = generate_frames(db, slug, start_ts, end_ts, out_dir)
    print(f"[preprocess] Generated {frame_count} frames")

    # Build manifest
    manifest = build_manifest(slug, title, start_ts, end_ts, frame_count)
    manifest_path = os.path.join(out_dir, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"[preprocess] Manifest: {manifest_path}")

    # Update index
    update_index(REPLAY_DIR, slug, manifest)

    db.close()
    print(f"\n[preprocess] Done! Replay at: {out_dir}/")
    print(f"  {frame_count} frames")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ARGUS Pre-processor")
    parser.add_argument("db", help="SQLite database path")
    parser.add_argument("--slug", required=True, help="Event slug (URL-safe)")
    parser.add_argument("--title", default="", help="Human-readable title")
    args = parser.parse_args()
    main(args.db, args.slug, args.title)
