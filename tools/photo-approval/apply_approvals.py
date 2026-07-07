#!/usr/bin/env python3
"""Merge an approvals.json export back into the ARGUS source data files.

Usage:
    python apply_approvals.py path/to/approvals.json

Writes to:
    data/bases.json            (sets photo_url on matching ids)
    data/military-bases.json   (sets photo_url on matching ids)
    data/intel-photos.json     (id → photo_url map; loaded at runtime by js/intel.js)

Idempotent: rerunning with the same approvals.json produces the same files.
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BASES = REPO / "data" / "bases.json"
MILITARY = REPO / "data" / "military-bases.json"
INTEL_PHOTOS = REPO / "data" / "intel-photos.json"


def patch_data_file(path: Path, approvals: dict) -> int:
    data = json.loads(path.read_text())
    matched = 0
    by_id = {e["id"]: e for e in data}
    for ent_id, decision in approvals.items():
        if decision.get("decision") != "approved":
            continue
        if ent_id not in by_id:
            continue  # may belong to a different type
        by_id[ent_id]["photo_url"] = decision["photo_url"]
        matched += 1
    path.write_text(json.dumps(data, indent=2) + "\n")
    return matched


def write_intel_photos(approvals: dict, intel_ids: set[str]) -> int:
    out = {}
    for ent_id, decision in approvals.items():
        if decision.get("decision") != "approved":
            continue
        if ent_id in intel_ids:
            out[ent_id] = decision["photo_url"]
    INTEL_PHOTOS.write_text(json.dumps(out, indent=2) + "\n")
    return len(out)


def load_intel_ids() -> set[str]:
    """Parse INTEL_ENTITIES ids out of js/intel.js."""
    intel_js = (REPO / "js" / "intel.js").read_text()
    import re
    return set(re.findall(r"id:\s*'([a-z0-9-]+)'", intel_js))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    approvals_path = Path(sys.argv[1])
    payload = json.loads(approvals_path.read_text())
    approvals = payload.get("approvals", {})

    base_data_ids = {e["id"] for e in json.loads(BASES.read_text())}
    mil_data_ids = {e["id"] for e in json.loads(MILITARY.read_text())}
    intel_ids = load_intel_ids()

    ub_count = patch_data_file(BASES, approvals)
    mb_count = patch_data_file(MILITARY, approvals)
    intel_count = write_intel_photos(approvals, intel_ids)

    approved_ids = {k for k, v in approvals.items() if v.get("decision") == "approved"}
    unmatched = approved_ids - base_data_ids - mil_data_ids - intel_ids

    print(f"Underground bases: {ub_count} photo_url fields set in {BASES.name}")
    print(f"Military bases:    {mb_count} photo_url fields set in {MILITARY.name}")
    print(f"Intel:             {intel_count} entries in {INTEL_PHOTOS.name}")
    if unmatched:
        print(f"\n[!] Approvals with ids not found in any source file ({len(unmatched)}):")
        for uid in sorted(unmatched):
            print(f"    {uid}")


if __name__ == "__main__":
    main()
