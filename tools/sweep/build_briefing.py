#!/usr/bin/env python3
"""Build the ARGUS sweep briefing (HTML) from the sweep/*.md agent reports + repo data.

Env: SWEEP_DIR (default: this session's scratchpad sweep dir), ARGUS_DIR (default ~/argus),
     OUT (default ~/argus/reports/sweep-2026-08-28.html)
"""
import json, os, re, html, pathlib, subprocess, datetime

SWEEP = pathlib.Path(os.environ.get('SWEEP_DIR', pathlib.Path(__file__).resolve().parent / 'inbox'))
ARGUS = pathlib.Path(os.environ.get('ARGUS_DIR', pathlib.Path(__file__).resolve().parents[2]))
DATE = os.environ.get('SWEEP_DATE', datetime.date.today().isoformat())
OUT = pathlib.Path(os.environ.get('OUT', str(pathlib.Path.home() / 'argus-sweeps' / DATE / 'briefing.html')))

THEATERS = [
    ('iran', 'Iran / Persian Gulf', '#ef4444', 'I'),
    ('ukraine-russia', 'Ukraine–Russia', '#fbbf24', 'U'),
    ('indo-pacific', 'Indo-Pacific', '#3b82f6', 'F'),
    ('sudan', 'Sudan', '#f97316', 'D'),
    ('sahel', 'Sahel', '#a855f7', 'H'),
    ('myanmar', 'Myanmar', '#22c55e', 'M'),
    ('korea', 'Korean Peninsula', '#06b6d4', 'V'),
    ('arctic', 'Arctic', '#38bdf8', 'B'),
    ('india-pakistan', 'India–Pakistan', '#ec4899', '4'),
    ('drc-great-lakes', 'DRC / Great Lakes', '#84cc16', '5'),
    ('israel-palestine', 'Israel–Palestine', '#6366f1', '6'),
]
NEW_THEATERS = {'india-pakistan', 'drc-great-lakes', 'israel-palestine'}

TYPE_COLORS = {
    'glacial': '#a5f3fc', 'avalanche': '#e0f2fe', 'landslide': '#d97706', 'flood': '#0ea5e9',
    'wildfire': '#f97316', 'cyclone': '#a78bfa', 'tornado': '#c4b5fd', 'storm': '#818cf8',
    'volcano': '#fb7185', 'heatwave': '#fde047', 'coldwave': '#bae6fd', 'drought': '#d6a55c',
    'tsunami': '#14b8a6', 'earthquake': '#f87171', 'industrial': '#9ca3af', 'epidemic': '#84cc16',
}


def read(p):
    try:
        return pathlib.Path(p).read_text()
    except FileNotFoundError:
        return ''


def section(md, pattern):
    """Text under the first heading matching `pattern`, up to the next heading of same-or-higher level."""
    lines = md.splitlines()
    out, on, level = [], False, 0
    for ln in lines:
        m = re.match(r'^(#{1,6})\s+(.*)', ln)
        if m:
            if on and len(m.group(1)) <= level:
                break
            if not on and re.search(pattern, m.group(2)):
                on, level = True, len(m.group(1))
                continue
        if on:
            out.append(ln)
    return '\n'.join(out).strip()


def inline(md):
    s = html.escape(md)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    s = re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)', r'<a href="\2" target="_blank" rel="noopener">\1</a>', s)
    s = re.sub(r'(?<![">])(https?://[^\s<)]+)', r'<a href="\1" target="_blank" rel="noopener">\1</a>', s)
    return s


def md_to_html(md):
    """Tiny converter: paragraphs, bullet lists, numbered lists, tables, sub-headings."""
    out, para, lst, table = [], [], None, []

    def flush_para():
        nonlocal para
        if para:
            out.append('<p>' + inline(' '.join(para)) + '</p>')
            para = []

    def flush_list():
        nonlocal lst
        if lst:
            tag, items = lst
            out.append(f'<{tag}>' + ''.join(f'<li>{inline(i)}</li>' for i in items) + f'</{tag}>')
            lst = None

    def flush_table():
        nonlocal table
        if table:
            rows = [r for r in table if not re.match(r'^\s*\|?\s*-{2,}', r)]
            cells = [[c.strip() for c in r.strip().strip('|').split('|')] for r in rows]
            if cells:
                head = ''.join(f'<th>{inline(c)}</th>' for c in cells[0])
                body = ''.join('<tr>' + ''.join(f'<td>{inline(c)}</td>' for c in r) + '</tr>' for r in cells[1:])
                out.append(f'<div class="tablewrap"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>')
            table = []

    for ln in md.splitlines():
        if ln.strip().startswith('|'):
            flush_para(); flush_list(); table.append(ln); continue
        else:
            flush_table()
        m = re.match(r'^\s*[-*]\s+(.*)', ln)
        n = re.match(r'^\s*\d+[.)]\s+(.*)', ln)
        h = re.match(r'^(#{1,6})\s+(.*)', ln)
        if h:
            flush_para(); flush_list()
            out.append(f'<h4>{inline(h.group(2))}</h4>')
        elif m:
            flush_para()
            if lst and lst[0] != 'ul': flush_list()
            lst = lst or ('ul', [])
            lst[1].append(m.group(1))
        elif n:
            flush_para()
            if lst and lst[0] != 'ol': flush_list()
            lst = lst or ('ol', [])
            lst[1].append(n.group(1))
        elif ln.strip() == '' or ln.strip() == '---':
            flush_para(); flush_list()
        else:
            if lst and ln.startswith('  '):
                lst[1][-1] += ' ' + ln.strip()
            else:
                flush_list(); para.append(ln.strip())
    flush_para(); flush_list(); flush_table()
    return '\n'.join(out)


def git_head_count(theater):
    try:
        raw = subprocess.run(['git', 'show', f'HEAD:data/theaters/{theater}.json'], cwd=ARGUS,
                             capture_output=True, text=True, check=True).stdout
        return len(json.loads(raw))
    except Exception:
        return 0


# ── Gather ────────────────────────────────────────────────────────────────
theater_data = {}
for tid, name, color, key in THEATERS:
    evs = json.load(open(ARGUS / 'data' / 'theaters' / f'{tid}.json'))
    md = read(SWEEP / f'{tid}.md')
    theater_data[tid] = {
        'name': name, 'color': color, 'key': key, 'count': len(evs),
        'before': git_head_count(tid),
        'latest': max(e['date'] for e in evs)[:10],
        'state': section(md, r'[Ss]tate of the theater'),
        'corrections': section(md, r'Corrections'),
        'dropped': section(md, r'Dropped'),
        'events': sorted(evs, key=lambda e: e['date']),
    }

scan_md = read(SWEEP / 'global-scan.md')
scan_table = section(scan_md, r'Ranked')
scan_recs = section(scan_md, r'Top-3')
dis_md = read(SWEEP / 'disasters.md')
langtang = section(dis_md, r'Full Dossier')
year = section(dis_md, r'Year in Review')
disasters = json.load(open(ARGUS / 'data' / 'disasters.json'))

total_after = sum(t['count'] for t in theater_data.values())
total_before = sum(t['before'] for t in theater_data.values())

# ── Render ────────────────────────────────────────────────────────────────
css = """
:root{--bg:#0a0a0f;--surface:#10101a;--border:rgba(255,255,255,.09);--text:rgba(255,255,255,.9);--dim:rgba(255,255,255,.62);--faint:rgba(255,255,255,.42);--accent:#f5b942;--accent-dim:rgba(245,185,66,.14);--mono:'SF Mono','Cascadia Code','Fira Code',Consolas,monospace;--sans:Inter,'Helvetica Neue',Arial,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.55;padding:0 0 80px}
a{color:var(--accent);text-decoration:none;border-bottom:1px dotted rgba(245,185,66,.4)}a:hover{border-bottom-color:var(--accent)}
code{font-family:var(--mono);font-size:.85em;background:rgba(255,255,255,.06);padding:1px 5px;border-radius:3px}
header{position:sticky;top:0;z-index:5;background:rgba(16,16,26,.92);backdrop-filter:blur(14px);border-bottom:1px solid var(--border);padding:12px 32px;display:flex;justify-content:space-between;align-items:center}
header .logo{font-family:var(--mono);font-weight:700;letter-spacing:3px;color:var(--accent);font-size:15px}header .logo span{color:var(--faint);font-weight:400}
header .meta{font-family:var(--mono);font-size:11px;color:var(--dim);letter-spacing:1px}
main{max-width:1180px;margin:0 auto;padding:28px 32px}
h1{font-family:var(--mono);font-size:26px;letter-spacing:1px;margin:12px 0 4px}
h2{font-family:var(--mono);font-size:12px;letter-spacing:2.5px;text-transform:uppercase;color:var(--accent);margin:44px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--border)}
h3{font-family:var(--mono);font-size:15px;margin:0 0 6px}
h4{font-family:var(--mono);font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--dim);margin:14px 0 6px}
p{margin:0 0 10px}ul,ol{margin:4px 0 10px 20px}li{margin:3px 0}
.lede{color:var(--dim);font-size:15px;max-width:900px}
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:22px 0 6px}
.tile{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px 14px}
.tile .k{font-family:var(--mono);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--faint)}
.tile .v{font-family:var(--mono);font-size:24px;color:var(--accent);margin-top:4px}.tile .v small{font-size:12px;color:var(--dim)}
.card{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:6px;padding:16px 20px;margin:0 0 14px}
.card .hd{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.card .hd .key{font-family:var(--mono);font-size:10px;border:1px solid var(--border);border-radius:3px;padding:1px 6px;color:var(--faint)}
.card .hd .stat{font-family:var(--mono);font-size:11px;color:var(--dim);margin-left:auto}
.badge{font-family:var(--mono);font-size:10px;letter-spacing:1px;text-transform:uppercase;padding:2px 7px;border-radius:3px;background:var(--accent-dim);color:var(--accent)}
.badge.new{background:rgba(236,72,153,.16);color:#f472b6}
details{margin-top:8px}summary{cursor:pointer;font-family:var(--mono);font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--faint)}summary:hover{color:var(--text)}
details .inner{padding:8px 0 0 4px;color:var(--dim);font-size:14px}
.tablewrap{overflow-x:auto;margin:8px 0 14px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--border);vertical-align:top}th{font-family:var(--mono);font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--faint)}
td.mono{font-family:var(--mono);font-size:12px;white-space:nowrap}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;vertical-align:middle}
.dossier{background:linear-gradient(180deg,rgba(165,243,252,.06),transparent 40%),var(--surface);border:1px solid rgba(165,243,252,.25);border-radius:8px;padding:22px 26px;margin:6px 0 18px}
.dossier h3{color:#a5f3fc;font-size:18px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:18px}@media(max-width:860px){.two{grid-template-columns:1fr}}
.kv{font-family:var(--mono);font-size:12px;color:var(--dim)}.kv b{color:var(--text);font-weight:600}
.changes li{margin:5px 0}
.note{font-size:13px;color:var(--faint);font-family:var(--mono)}
"""

def theater_card(tid):
    t = theater_data[tid]
    delta = t['count'] - t['before']
    new = tid in NEW_THEATERS
    events_rows = ''.join(
        f'<tr><td class="mono">{e["date"][:10]}</td><td>{html.escape(e["name"])}</td><td class="mono">{html.escape(e["type"])}</td><td>{html.escape(str(e.get("casualties") or ""))[:90]}</td></tr>'
        for e in t['events'] if e['date'] >= '2026-04-01' or new
    )
    extras = ''
    if t['corrections']:
        extras += f'<details><summary>Corrections applied / flagged</summary><div class="inner">{md_to_html(t["corrections"])}</div></details>'
    if t['dropped']:
        extras += f'<details><summary>Dropped as unverifiable</summary><div class="inner">{md_to_html(t["dropped"])}</div></details>'
    return f'''
<div class="card" style="border-left-color:{t['color']}">
  <div class="hd"><h3><span class="dot" style="background:{t['color']}"></span>{html.escape(t['name'])}</h3>
    <span class="key">preset {t['key']}</span>{'<span class="badge new">new theater</span>' if new else ''}
    <span class="stat">{t['before']} → <b>{t['count']}</b> events (+{delta}) · latest {t['latest']}</span></div>
  {md_to_html(t['state']) if t['state'] else '<p class="note">(new theater — see scan justification below)</p>'}
  <details><summary>{'Events' if new else 'Events added since April'} ({sum(1 for e in t['events'] if e['date'] >= '2026-04-01' or new)})</summary><div class="inner tablewrap"><table><thead><tr><th>Date</th><th>Event</th><th>Type</th><th>Casualties</th></tr></thead><tbody>{events_rows}</tbody></table></div></details>
  {extras}
</div>'''


dis_rows = ''.join(
    f'<tr><td class="mono">{d["date"][:10]}</td><td><span class="dot" style="background:{TYPE_COLORS.get(d["type"], "#fb7185")}"></span>{html.escape(d["type"])}</td>'
    f'<td>{html.escape(d["name"])}</td><td>{html.escape(d.get("region") or "")}</td><td>{html.escape(d.get("casualties") or "—")}</td><td class="mono">{d["status"]}</td></tr>'
    for d in sorted(disasters, key=lambda d: d['date'])
)
langtang_entry = next((d for d in disasters if d['type'] == 'glacial'), None)

doc = f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ARGUS Sweep Briefing — {DATE}</title><style>{css}</style></head>
<body>
<header><div class="logo">ARGUS <span>// SWEEP BRIEFING</span></div><div class="meta">{DATE} · Fable 5 · research by Opus 4.8 agents (10 lanes)</div></header>
<main>
<h1>Current sweep — conflict theaters &amp; the new Disasters layer</h1>
<p class="lede">Everything below is now live on <a href="https://argus-intel-globe.netlify.app">argus-intel-globe.netlify.app</a>. All eight existing theaters were researched forward from their last event to today; three theaters were added on the global scan's recommendation; the glacial collapse of Aug 26 seeded a new F11 Disasters layer (curated 2026 events + the live GDACS alert feed).</p>

<div class="strip">
  <div class="tile"><div class="k">Conflict events</div><div class="v">{total_after} <small>was {total_before}</small></div></div>
  <div class="tile"><div class="k">Theaters</div><div class="v">11 <small>was 8</small></div></div>
  <div class="tile"><div class="k">Disasters · curated</div><div class="v">{len(disasters)} <small>2026 YTD</small></div></div>
  <div class="tile"><div class="k">Disasters · live</div><div class="v">GDACS <small>30-day alerts, 10-min poll</small></div></div>
  <div class="tile"><div class="k">New keys</div><div class="v">F11 · Z <small>· 4 · 5 · 6</small></div></div>
</div>

<h2>The glacial collapse — Langtang Lirung, 26 Aug 2026</h2>
<div class="dossier">
  <h3>{html.escape(langtang_entry['name']) if langtang_entry else 'Nepal–Tibet glacial collapse'}</h3>
  <div class="two">
    <div>
      <div class="kv"><b>When</b> 02:55 UTC · 08:40 NPT, 26 Aug 2026</div>
      <div class="kv"><b>Source</b> ~28.38 N 85.50 E, ~5,200 m, Lhende Khola (Tibet side)</div>
      <div class="kv"><b>Impact</b> Timure / Syapru Besi, Rasuwa district · Gyirong Port</div>
      <div class="kv"><b>Scale</b> {html.escape(langtang_entry['scale']) if langtang_entry else ''}</div>
    </div>
    <div>
      <div class="kv"><b>Casualties</b> {html.escape(langtang_entry['casualties']) if langtang_entry else ''}</div>
      <div class="kv"><b>Displaced</b> {html.escape(langtang_entry.get('displaced') or '') if langtang_entry else ''}</div>
      <div class="kv"><b>Cause</b> {html.escape(langtang_entry.get('cause') or '') if langtang_entry else ''}</div>
      <div class="kv"><b>In ARGUS</b> preset <code>Z</code> flies to it · F11 dossier carries the six sources</div>
    </div>
  </div>
  <details open><summary>Full dossier (agent report)</summary><div class="inner">{md_to_html(langtang)}</div></details>
</div>

<h2>State of the theaters — {DATE}</h2>
{''.join(theater_card(tid) for tid, *_ in THEATERS if tid not in NEW_THEATERS)}

<h2>New theaters (from the global scan)</h2>
<p class="lede">The scan ranked 22 candidates outside the existing eight. Three cleared the bar and are now live with seed timelines; Ethiopia (Fano/Tigray), Haiti and Somalia were near-misses to keep on watch.</p>
{''.join(theater_card(tid) for tid, *_ in THEATERS if tid in NEW_THEATERS)}
<details><summary>Scan justifications</summary><div class="inner">{md_to_html(scan_recs)}</div></details>
<details><summary>Full ranked candidate table (22)</summary><div class="inner">{md_to_html(scan_table)}</div></details>

<h2>2026 disaster year — curated layer contents</h2>
{md_to_html(year)}
<div class="tablewrap"><table><thead><tr><th>Date</th><th>Type</th><th>Event</th><th>Region</th><th>Casualties</th><th>Status</th></tr></thead><tbody>{dis_rows}</tbody></table></div>
<p class="note">Earthquakes are included only at M7+ or ≥50 dead (F1 carries the live USGS feed). The live GDACS feed (TC/FL/VO/DR/WF, Green/Orange/Red, last 30 days) is drawn at alert-scaled sizes; Green wildfires under 20,000 ha are dropped for legibility.</p>

<h2>What shipped in ARGUS</h2>
<ul class="changes">
  <li><b>F11 Disasters layer</b> — <code>js/disasters.js</code>: curated <code>data/disasters.json</code> + live GDACS SEARCH feed (CORS-open, no proxy), 16 typed canvas icons, alert-level sizing, time-scrubber aware, 12th hash-state bit, stats-bar item with "GDACS offline" degradation, dossier with chips/scale/cause/linked sources.</li>
  <li><b>Preset Z</b> → Langtang glacier collapse (auto-enables F11). Presets <b>4 / 5 / 6</b> → India–Pakistan, DRC / Great Lakes, Israel–Palestine (auto-enable F9).</li>
  <li><b>Conflict theaters</b> 8 → 11; events {total_before} → {total_after}. Theater filter, hash mask and dossier pick up the new theaters automatically.</li>
  <li><b>Dossier sources are links now</b> — new events carry "Outlet — URL" sources; the conflict and disaster dossiers render them as links (URL-gated by <code>safeHref</code>); legacy bare outlet names still render as text.</li>
  <li><b>F-key mapping</b> now matches each layer's declared key (fixes F11 silently toggling Antarctica).</li>
  <li><b>Bug fixed in passing</b> — Antarctica dossier crashed on operations whose <code>achievements</code> is a string (Operation Highjump, German Antarctic Expedition).</li>
  <li><b>Corrections applied</b> — Pokrovsk retitled (city still contested per ISW); El Fasher casualties consolidated to the UN FFM finding; Kidal withdrawal date; Min Aung Hlaing inauguration date; Mandalay quake toll; junta election-announcement month; DPRK Kursk casualties; a DPRK ICBM test removed from Indo-Pacific (already in Korea). Gap events added: Niamey airport assault (Jan 29), Orthodox Easter truce (Apr 11), and four 2025 Korea milestones.</li>
</ul>

<h2>Open for your call</h2>
<ul class="changes">
  <li><b>Monitor list</b> — Ethiopia (Fano/Tigray two-front crisis), Haiti (10 massacres H1 2026), Somalia (al-Shabaab +60%). Any of these can become a theater on the next sweep.</li>
  <li><b>Dead preset keys</b> (pre-existing) — <code>T</code> Mogul Area is shadowed by the timeline toggle, <code>A</code> Pentagon by the Antarctica toggle, <code>L</code> Northwestern fires together with the labels toggle. Reassign or drop.</li>
  <li><b>Iran theater scope</b> — with Israel–Palestine split out, the Gaza-adjacent Iran events stay where they are; no re-tagging was done.</li>
  <li><b>Photos</b> — none of the new events or disasters carry <code>photo_url</code>; the photo-approval workflow can cover the iconic ones.</li>
</ul>
</main></body></html>'''

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(doc)
print(f'wrote {OUT} ({len(doc)//1024} KB) · theaters {total_before}→{total_after} · disasters {len(disasters)}')
