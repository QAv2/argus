#!/usr/bin/env python3
"""Merge COMNAP CSV data into antarctica.json.

Enriches existing station entries with photo_url, webcam_url, and peak_pop
from the COMNAP CSV; adds any COMNAP stations not already present.

Idempotent — running twice produces the same result as once.
"""
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANT_PATH = ROOT / 'data' / 'antarctica.json'
CSV_PATH = ROOT / 'data' / 'comnap_stations.csv'

# Normalize country name variants to a single canonical form
COUNTRY_ALIASES = {
    'republic of korea': 'south korea',
    'türkiye': 'turkey',
    'turkiye': 'turkey',
    'republic of belarus': 'belarus',
    'czech republic': 'czech republic',
}

def canonical_country(c):
    if not c: return ''
    parts = [p.strip() for p in c.replace('/', ',').split(',') if p.strip()]
    canon = []
    for p in parts:
        lc = p.lower()
        canon.append(COUNTRY_ALIASES.get(lc, lc))
    # Sort multi-country to canonicalize "Italy/France" == "France/Italy"
    return '/'.join(sorted(set(canon)))

def norm_name(s):
    if not s: return ''
    s = s.lower().strip()
    s = re.sub(r'\b(station|antartic|antarctic|base|research|scientific|camp|aerodrome|skiway)\b', ' ', s)
    s = re.sub(r'[^\w\s]', ' ', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def to_int(v):
    if v is None: return None
    s = str(v).strip().replace(',', '')
    if not s: return None
    try: return int(float(s))
    except ValueError: return None

def to_float(v):
    if v is None: return None
    s = str(v).strip()
    if not s: return None
    try: return float(s)
    except ValueError: return None

def main():
    with open(ANT_PATH) as f:
        data = json.load(f)
    stations = data['research_stations']

    with open(CSV_PATH, encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))

    # Index existing stations by (norm_name, canonical_country) AND by coord
    name_idx = {}
    coord_idx = {}
    for i, s in enumerate(stations):
        cc = canonical_country(s.get('country', ''))
        for nm in {norm_name(s['name']), norm_name(s.get('official_name', ''))}:
            if nm:
                name_idx.setdefault((nm, cc), []).append(i)
        coord_key = (round(s['lat'], 2), round(s['lon'], 2))
        coord_idx.setdefault(coord_key, []).append(i)

    matched = 0
    added = 0
    match_log = []
    add_log = []

    for r in rows:
        eng = (r.get('English Name') or '').strip()
        off = (r.get('Official Name') or '').strip()
        op = (r.get('Operator (primary)') or '').strip()
        op_add = (r.get('Operator (additional)') or '').strip()
        country_raw = op + ('/' + op_add if op_add and op_add != op else '')
        cc = canonical_country(country_raw)
        lat = to_float(r.get('Latitude (DD)'))
        lon = to_float(r.get('Longitude (DD)'))
        if lat is None or lon is None:
            continue

        # Try name-based match first
        found = None
        for nm in {norm_name(eng), norm_name(off)}:
            if not nm: continue
            if (nm, cc) in name_idx:
                found = name_idx[(nm, cc)][0]
                break

        # Fallback: coord-proximity match within 0.02° (~2 km).
        # Match if name normalizes equal OR country canonicalizes equal/subset.
        if found is None:
            cc_set = set(cc.split('/')) if cc else set()
            csv_norm_names = {norm_name(eng), norm_name(off)} - {''}
            for dlat in (-0.02, -0.01, 0, 0.01, 0.02):
                for dlon in (-0.02, -0.01, 0, 0.01, 0.02):
                    key = (round(lat + dlat, 2), round(lon + dlon, 2))
                    if key in coord_idx:
                        for idx in coord_idx[key]:
                            existing = stations[idx]
                            ex_cc = canonical_country(existing.get('country', ''))
                            ex_cc_set = set(ex_cc.split('/')) if ex_cc else set()
                            ex_norm_names = {norm_name(existing['name']), norm_name(existing.get('official_name', ''))} - {''}
                            country_match = (ex_cc == cc or
                                            (ex_cc_set & cc_set))
                            name_match = bool(csv_norm_names & ex_norm_names)
                            coords_close = (abs(existing['lat'] - lat) < 0.02 and
                                            abs(existing['lon'] - lon) < 0.02)
                            if coords_close and (country_match or name_match):
                                found = idx
                                break
                    if found is not None: break
                if found is not None: break

        if found is not None:
            s = stations[found]
            photo = (r.get('Photo URL') or '').strip()
            webcam = (r.get('Webcam URL') or '').strip()
            pop = to_int(r.get('Peak Population'))
            changed = []
            if photo and not s.get('photo_url'):
                s['photo_url'] = photo; changed.append('photo')
            if webcam and not s.get('webcam_url'):
                s['webcam_url'] = webcam; changed.append('webcam')
            if pop is not None and not s.get('peak_pop'):
                s['peak_pop'] = pop; changed.append(f'pop={pop}')
            matched += 1
            if changed:
                match_log.append(f"  {s['name']} ({s['country']}) — {', '.join(changed)}")
            continue

        # New entry
        elev = to_float(r.get('Elevation (meters)'))
        if elev is not None and elev == int(elev):
            elev = int(elev)
        new_stn = {
            'name': eng or off,
            'official_name': off or eng,
            'country': country_raw or op,
            'lat': lat,
            'lon': lon,
            'year': to_int(r.get('Year Established')),
            'seasonality': (r.get('Seasonality') or '').strip(),
            'status': (r.get('Status') or '').strip(),
            'type': (r.get('Type') or '').strip(),
            'peak_pop': to_int(r.get('Peak Population')),
            'elevation_m': elev,
            'notes': (r.get('Antarctic Region') or '').strip() or None,
        }
        photo = (r.get('Photo URL') or '').strip()
        webcam = (r.get('Webcam URL') or '').strip()
        if photo: new_stn['photo_url'] = photo
        if webcam: new_stn['webcam_url'] = webcam
        new_stn = {k: v for k, v in new_stn.items() if v not in (None, '')}
        stations.append(new_stn)
        added += 1
        add_log.append(f"  {new_stn['name']} ({new_stn['country']}) — {new_stn.get('seasonality','?')}/{new_stn.get('status','?')}")

    # Sort: year-round first, then by country, then by name
    stations.sort(key=lambda s: (
        0 if s.get('seasonality') == 'Year-Round' else 1,
        s.get('country', ''),
        s.get('name', ''),
    ))

    data['metadata'] = data.get('metadata', {})
    data['metadata']['comnap_merged'] = True
    data['metadata']['station_count'] = len(stations)

    with open(ANT_PATH, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f'matched & enriched: {matched}')
    print(f'newly added: {added}')
    print(f'final station count: {len(stations)}')
    print()
    if match_log:
        print(f'--- enriched (sample of {len(match_log)}) ---')
        for line in match_log[:12]: print(line)
        if len(match_log) > 12: print(f'  ... +{len(match_log)-12} more')
    if add_log:
        print()
        print('--- newly added ---')
        for line in add_log: print(line)

if __name__ == '__main__':
    main()
