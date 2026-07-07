#!/usr/bin/env python3
"""ARGUS Capture Daemon — records ADS-B + AIS to SQLite.

Usage:
  python capture/capture.py --db data/captures/event.db --duration 120
  python capture/capture.py --db data/captures/event.db  # run until Ctrl+C
"""

import argparse
import asyncio
import json
import os
import signal
import time

import aiohttp
import aiosqlite

# ── Config ──────────────────────────────────────────────────────────────────

ADSB_URL = "https://api.adsb.lol/v2/mil"
ADSB_INTERVAL = 15        # seconds between ADS-B polls

AIS_INTERVAL = 30          # seconds between AIS polls
AIS_WS_URL = "wss://stream.aisstream.io/v0/stream"

# ── Schema ──────────────────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS aircraft_snapshots (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL,
    hex TEXT NOT NULL,
    flight TEXT,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    alt_baro INTEGER,
    gs REAL,
    track REAL,
    nic INTEGER,
    nac_p INTEGER,
    sil INTEGER,
    category TEXT,
    db_flags INTEGER,
    squawk TEXT
);
CREATE INDEX IF NOT EXISTS idx_ac_ts ON aircraft_snapshots(ts);

CREATE TABLE IF NOT EXISTS ais_snapshots (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL,
    mmsi TEXT NOT NULL,
    name TEXT,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    speed REAL,
    course REAL,
    heading REAL,
    ship_type INTEGER,
    status INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ais_ts ON ais_snapshots(ts);
"""

# ── Globals ─────────────────────────────────────────────────────────────────

running = True
stats = {"adsb_polls": 0, "adsb_rows": 0, "ais_polls": 0, "ais_rows": 0}


def handle_signal(sig, frame):
    global running
    print(f"\n[capture] Received signal {sig}, shutting down...")
    running = False


# ── ADS-B Capture ───────────────────────────────────────────────────────────

async def poll_adsb(session, db):
    """Poll adsb.lol /v2/all every ADSB_INTERVAL seconds."""
    global running
    while running:
        try:
            ts = int(time.time())
            async with session.get(ADSB_URL, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200:
                    print(f"[adsb] HTTP {resp.status}")
                    await asyncio.sleep(ADSB_INTERVAL)
                    continue
                data = await resp.json()

            aircraft = data.get("ac", [])
            rows = []
            for ac in aircraft:
                lat = ac.get("lat")
                lon = ac.get("lon")
                if lat is None or lon is None:
                    continue
                rows.append((
                    ts,
                    ac.get("hex", ""),
                    ac.get("flight", "").strip() if ac.get("flight") else None,
                    lat, lon,
                    ac.get("alt_baro"),
                    ac.get("gs"),
                    ac.get("track"),
                    ac.get("nic"),
                    ac.get("nac_p"),
                    ac.get("sil"),
                    ac.get("category"),
                    ac.get("dbFlags"),
                    ac.get("squawk"),
                ))

            if rows:
                await db.executemany(
                    "INSERT INTO aircraft_snapshots (ts,hex,flight,lat,lon,alt_baro,gs,track,nic,nac_p,sil,category,db_flags,squawk) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    rows,
                )
                await db.commit()
                stats["adsb_rows"] += len(rows)

            stats["adsb_polls"] += 1
            print(f"[adsb] poll {stats['adsb_polls']}: {len(rows)} aircraft (total: {stats['adsb_rows']})")

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[adsb] error: {e}")

        await asyncio.sleep(ADSB_INTERVAL)


# ── AIS Capture ─────────────────────────────────────────────────────────────

async def poll_ais(session, db):
    """Connect to aisstream.io WebSocket via the Netlify vessel proxy pattern.

    If AISSTREAM_API_KEY is not set, skip AIS capture silently.
    """
    global running
    api_key = os.environ.get("AISSTREAM_API_KEY", "")
    if not api_key:
        print("[ais] AISSTREAM_API_KEY not set, skipping AIS capture")
        return

    while running:
        try:
            async with session.ws_connect(AIS_WS_URL) as ws:
                # Subscribe to all positions
                subscribe_msg = {
                    "APIKey": api_key,
                    "BoundingBoxes": [[[-90, -180], [90, 180]]],
                    "FilterMessageTypes": ["PositionReport"],
                }
                await ws.send_json(subscribe_msg)
                print("[ais] WebSocket connected")

                buffer = []
                last_flush = time.time()

                async for msg in ws:
                    if not running:
                        break
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        try:
                            data = json.loads(msg.data)
                        except json.JSONDecodeError:
                            continue

                        meta = data.get("MetaData", {})
                        pos = data.get("Message", {}).get("PositionReport", {})
                        if not pos:
                            continue

                        lat = pos.get("Latitude")
                        lon = pos.get("Longitude")
                        if lat is None or lon is None:
                            continue

                        buffer.append((
                            int(time.time()),
                            str(meta.get("MMSI", "")),
                            meta.get("ShipName", "").strip() if meta.get("ShipName") else None,
                            lat, lon,
                            pos.get("Sog"),
                            pos.get("Cog"),
                            pos.get("TrueHeading"),
                            meta.get("ShipType"),
                            pos.get("NavigationalStatus"),
                        ))

                        # Flush every AIS_INTERVAL seconds
                        now = time.time()
                        if now - last_flush >= AIS_INTERVAL and buffer:
                            await db.executemany(
                                "INSERT INTO ais_snapshots (ts,mmsi,name,lat,lon,speed,course,heading,ship_type,status) "
                                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                                buffer,
                            )
                            await db.commit()
                            stats["ais_rows"] += len(buffer)
                            stats["ais_polls"] += 1
                            print(f"[ais] flush {stats['ais_polls']}: {len(buffer)} vessels (total: {stats['ais_rows']})")
                            buffer.clear()
                            last_flush = now

                    elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                        break

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[ais] error: {e}, reconnecting in 10s...")
            await asyncio.sleep(10)


# ── Main ────────────────────────────────────────────────────────────────────

async def main(db_path, duration):
    global running
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    print(f"[capture] Database: {db_path}")
    print(f"[capture] Duration: {duration}min" if duration else "[capture] Duration: until Ctrl+C")
    print(f"[capture] ADS-B interval: {ADSB_INTERVAL}s | AIS interval: {AIS_INTERVAL}s")

    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)

    async with aiosqlite.connect(db_path) as db:
        await db.executescript(SCHEMA)
        await db.commit()

        async with aiohttp.ClientSession(
            headers={"User-Agent": "ARGUS-Capture/1.0"}
        ) as session:
            tasks = [
                asyncio.create_task(poll_adsb(session, db)),
                asyncio.create_task(poll_ais(session, db)),
            ]

            if duration:
                await asyncio.sleep(duration * 60)
                running = False
            else:
                while running:
                    await asyncio.sleep(1)

            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    print(f"\n[capture] Done. ADS-B: {stats['adsb_polls']} polls / {stats['adsb_rows']} rows | "
          f"AIS: {stats['ais_polls']} flushes / {stats['ais_rows']} rows")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ARGUS Capture Daemon")
    parser.add_argument("--db", required=True, help="SQLite database path")
    parser.add_argument("--duration", type=int, default=0, help="Duration in minutes (0 = until Ctrl+C)")
    args = parser.parse_args()
    asyncio.run(main(args.db, args.duration))
