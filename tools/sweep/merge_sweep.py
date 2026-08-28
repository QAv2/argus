#!/usr/bin/env python3
"""Validate + merge sweep output into ~/argus/data/theaters/<id>.json.

Usage:
  merge_sweep.py --check            # validate every sweep/<id>.json, report, write nothing
  merge_sweep.py --apply            # validate + append new events to the theater files
  merge_sweep.py --apply iran korea # only these theaters
"""
import json, sys, re, os, datetime, pathlib

SWEEP = pathlib.Path(os.environ.get('SWEEP_DIR', pathlib.Path(__file__).resolve().parent / 'inbox'))
THEATERS_DIR = pathlib.Path(__file__).resolve().parents[2] / 'data' / 'theaters'
KEYS = ['id', 'name', 'lat', 'lon', 'type', 'date', 'operation', 'parties', 'target',
        'casualties', 'description', 'sources', 'theater']
TYPES = {'airstrike', 'missile', 'naval', 'retaliation', 'blockade', 'cyber', 'nuclear',
         'ground', 'political', 'economic'}
ID_RE = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')


def parse_date(s):
    return datetime.datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ')


def validate(theater, events, existing_ids, floor_date):
    errs, warns = [], []
    seen = set()
    for i, e in enumerate(events):
        tag = f'[{i}] {e.get("id", "?")}'
        missing = [k for k in KEYS if k not in e]
        extra = [k for k in e if k not in KEYS]
        if missing: errs.append(f'{tag}: missing keys {missing}')
        if extra: warns.append(f'{tag}: extra keys {extra} (will be dropped)')
        if missing: continue
        if not ID_RE.match(e['id']): errs.append(f'{tag}: bad id format')
        if e['id'] in existing_ids: errs.append(f'{tag}: id collides with existing event')
        if e['id'] in seen: errs.append(f'{tag}: duplicate id within sweep')
        seen.add(e['id'])
        if e['theater'] != theater: errs.append(f'{tag}: theater={e["theater"]} != {theater}')
        if e['type'] not in TYPES: errs.append(f'{tag}: bad type {e["type"]}')
        try:
            lat, lon = float(e['lat']), float(e['lon'])
            if not (-90 <= lat <= 90 and -180 <= lon <= 180): errs.append(f'{tag}: lat/lon out of range')
            if lat == 0 and lon == 0: errs.append(f'{tag}: lat/lon is 0,0')
        except Exception:
            errs.append(f'{tag}: lat/lon not numeric')
        try:
            d = parse_date(e['date'])
            if d < floor_date: warns.append(f'{tag}: date {e["date"]} is before theater floor {floor_date.date()}')
            if d > datetime.datetime.utcnow() + datetime.timedelta(days=1): errs.append(f'{tag}: date in the future {e["date"]}')
        except Exception:
            errs.append(f'{tag}: bad date {e["date"]!r}')
        if not isinstance(e['parties'], list): errs.append(f'{tag}: parties not a list')
        if not isinstance(e['sources'], list) or not e['sources']: errs.append(f'{tag}: sources empty/not list')
        elif not any('http' in s for s in e['sources']): warns.append(f'{tag}: no URL in sources')
        if len(e['name']) > 70: warns.append(f'{tag}: name > 70 chars')
        if len(e['description']) < 40: warns.append(f'{tag}: description very short')
    return errs, warns


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '--check'
    only = set(sys.argv[2:])
    total_added = 0
    for path in sorted(SWEEP.glob('*.json')):
        theater = path.stem
        if theater.startswith('candidate-') or theater == 'disasters':
            continue
        if only and theater not in only:
            continue
        target = THEATERS_DIR / f'{theater}.json'
        if not target.exists():
            print(f'!! {theater}: no theater file at {target}')
            continue
        existing = json.load(open(target))
        existing_ids = {e['id'] for e in existing}
        floor = max(parse_date(e['date']) for e in existing)
        try:
            new = json.load(open(path))
        except Exception as ex:
            print(f'!! {theater}: JSON parse failed: {ex}')
            continue
        errs, warns = validate(theater, new, existing_ids, floor)
        dates = sorted(e.get('date', '') for e in new)
        print(f'== {theater}: existing {len(existing)} (latest {floor.date()}) · new {len(new)}'
              f' · span {dates[0][:10] if dates else "-"} → {dates[-1][:10] if dates else "-"}')
        for w in warns: print(f'   warn: {w}')
        for e in errs: print(f'   ERR : {e}')
        if mode == '--apply':
            if errs:
                print(f'   >> NOT applied ({len(errs)} errors)')
                continue
            clean = [{k: e[k] for k in KEYS} for e in new]
            clean.sort(key=lambda e: e['date'])
            merged = existing + clean
            with open(target, 'w') as f:
                json.dump(merged, f, indent=2, ensure_ascii=False)
                f.write('\n')
            total_added += len(clean)
            print(f'   >> applied: {len(existing)} → {len(merged)}')
    if mode == '--apply':
        print(f'TOTAL added: {total_added}')


if __name__ == '__main__':
    main()
