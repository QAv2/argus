#!/usr/bin/env python3
"""Apply hand-reviewed corrections to existing theater events / disasters.

Reads $SWEEP_DIR/corrections.json — a list of records:
  {"file": "theaters/iran" | "disasters", "id": "<event id>",
   "set":    {"field": new_value, ...},          # replace fields
   "append": {"description": " Update: ...",      # string fields get text appended,
              "sources": ["Outlet — https://..."]},  # list fields get items appended (deduped)
   "why": "one line, shown in the briefing"}

Usage:
  apply_corrections.py --check   # show what would change
  apply_corrections.py --apply   # write data files (idempotent: appends are skipped if already present)
"""
import json, os, sys, pathlib

SWEEP = pathlib.Path(os.environ.get('SWEEP_DIR', pathlib.Path(__file__).resolve().parent / 'inbox'))
DATA = pathlib.Path(__file__).resolve().parents[2] / 'data'


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '--check'
    recs = json.load(open(SWEEP / 'corrections.json'))
    files, errs, changes = {}, [], 0
    for r in recs:
        path = DATA / f"{r['file']}.json"
        if path not in files:
            files[path] = json.load(open(path))
        by_id = {e['id']: e for e in files[path]}
        ev = by_id.get(r['id'])
        if ev is None:
            errs.append(f"{r['file']}:{r['id']} not found"); continue
        for k, v in r.get('set', {}).items():
            if ev.get(k) != v:
                print(f"  set    {r['id']}.{k}: {str(ev.get(k))[:60]!r} → {str(v)[:60]!r}")
                ev[k] = v; changes += 1
        for k, v in r.get('append', {}).items():
            if isinstance(ev.get(k), list):
                add = [x for x in v if x not in ev[k]]
                if add:
                    print(f"  append {r['id']}.{k}: +{len(add)}")
                    ev[k] = ev[k] + add; changes += 1
            elif isinstance(ev.get(k), str):
                if v.strip() not in ev[k]:
                    print(f"  append {r['id']}.{k}: {v.strip()[:70]!r}")
                    ev[k] = ev[k].rstrip() + ' ' + v.strip(); changes += 1
            else:
                errs.append(f"{r['id']}.{k}: cannot append to {type(ev.get(k)).__name__}")
    for e in errs: print('  ERR :', e)
    print(f'{len(recs)} records · {changes} field changes · {len(errs)} errors')
    if mode == '--apply' and not errs:
        for path, data in files.items():
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
        print(f'>> wrote {len(files)} files')
    elif mode == '--apply':
        print('>> NOT applied'); sys.exit(1)


if __name__ == '__main__':
    main()
