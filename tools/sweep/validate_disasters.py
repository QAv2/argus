#!/usr/bin/env python3
"""Validate sweep/disasters.json against the ARGUS Disasters schema; --apply copies it to data/."""
import json, sys, re, os, datetime, pathlib

SRC = pathlib.Path(os.environ.get('SWEEP_DIR', pathlib.Path(__file__).resolve().parent / 'inbox')) / 'disasters.json'
DST = pathlib.Path(__file__).resolve().parents[2] / 'data' / 'disasters.json'
KEYS = ['id', 'name', 'lat', 'lon', 'type', 'date', 'end_date', 'status', 'region', 'scale',
        'casualties', 'displaced', 'cause', 'description', 'sources']
TYPES = {'glacial', 'landslide', 'flood', 'wildfire', 'cyclone', 'tornado', 'volcano', 'heatwave',
         'coldwave', 'drought', 'tsunami', 'avalanche', 'earthquake', 'industrial', 'epidemic', 'storm'}
ID_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')


def pd(s):
    return datetime.datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ')


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '--check'
    data = json.load(open(SRC))
    errs, warns, seen = [], [], set()
    for i, e in enumerate(data):
        tag = f'[{i}] {e.get("id", "?")}'
        missing = [k for k in KEYS if k not in e]
        extra = [k for k in e if k not in KEYS]
        if missing: errs.append(f'{tag}: missing {missing}')
        if extra: warns.append(f'{tag}: extra {extra} (dropped)')
        if missing: continue
        if not ID_RE.match(e['id']): errs.append(f'{tag}: bad id')
        if e['id'] in seen: errs.append(f'{tag}: dup id')
        seen.add(e['id'])
        if e['type'] not in TYPES: errs.append(f'{tag}: bad type {e["type"]}')
        if e['status'] not in ('ongoing', 'concluded'): errs.append(f'{tag}: bad status {e["status"]}')
        try:
            lat, lon = float(e['lat']), float(e['lon'])
            if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
                errs.append(f'{tag}: bad lat/lon')
        except Exception:
            errs.append(f'{tag}: lat/lon not numeric')
        try:
            d = pd(e['date'])
            if d > datetime.datetime.utcnow() + datetime.timedelta(days=1): errs.append(f'{tag}: future date')
            if d < datetime.datetime(2025, 12, 1): warns.append(f'{tag}: date before 2026: {e["date"]}')
        except Exception:
            errs.append(f'{tag}: bad date {e["date"]!r}')
        if e['end_date'] is not None:
            try: pd(e['end_date'])
            except Exception: errs.append(f'{tag}: bad end_date {e["end_date"]!r}')
        if not isinstance(e['sources'], list) or not e['sources']: errs.append(f'{tag}: sources empty')
        elif not any('http' in s for s in e['sources']): warns.append(f'{tag}: no URL in sources')
        for k in ('casualties', 'displaced', 'cause', 'scale', 'region'):
            if e[k] is not None and not isinstance(e[k], str): errs.append(f'{tag}: {k} not string/null')
        if len(e['name']) > 50: warns.append(f'{tag}: name > 50 chars ({len(e["name"])})')
    import collections
    print(f'{len(data)} entries · types: {dict(collections.Counter(e.get("type") for e in data))}')
    print(f'status: {dict(collections.Counter(e.get("status") for e in data))}')
    dates = sorted(e.get('date', '') for e in data)
    print(f'span: {dates[0][:10]} → {dates[-1][:10]}')
    for w in warns: print('  warn:', w)
    for e in errs: print('  ERR :', e)
    if mode == '--apply':
        if errs:
            print('>> NOT applied'); sys.exit(1)
        clean = [{k: e[k] for k in KEYS} for e in data]
        clean.sort(key=lambda e: e['date'])
        with open(DST, 'w') as f:
            json.dump(clean, f, indent=2, ensure_ascii=False); f.write('\n')
        print(f'>> wrote {DST} ({len(clean)} entries)')


if __name__ == '__main__':
    main()
