# -*- coding: utf-8 -*-
"""Builds exercises.html -> rendered to exercises.pdf by headless Chrome."""

# ---------------------------------------------------------------- palette --
INK, BODY, MUT, FAINT = "#141413", "#3d3d3a", "#6c6a64", "#8e8b82"
LINE, SURF, RAIS = "#ded6c9", "#faf8f4", "#f2ede4"
ACC, ACCF = "#a9583e", "#f9efe9"          # coral, print-safe
OK,  OKF  = "#2f7d69", "#e9f4f0"
WRN, WRNF = "#9a6a15", "#fbf3e2"
BAD, BADF = "#b23a35", "#fbecea"
BLU, BLUF = "#2d6597", "#eaf1f7"

K = {"n": (SURF, LINE), "a": (ACCF, ACC), "ok": (OKF, OK),
     "w": (WRNF, WRN), "b": (BADF, BAD), "c": (BLUF, BLU), "g": (RAIS, LINE)}

# ------------------------------------------------------------ svg helpers --
def esc(s): return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def box(x, y, w, h, title="", sub="", kind="n", dash=False, r=5, tfs=12, sfs=10, mono=False):
    f, s = K[kind]
    d = ' stroke-dasharray="5 4"' if dash else ""
    o = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{f}" stroke="{s}" stroke-width="1.4"{d}/>']
    cx = x + w / 2
    lines = [l for l in (title, sub) if l]
    if title and sub:
        o.append(f'<text x="{cx}" y="{y+h/2-3}" text-anchor="middle" class="{"dm" if mono else "dt"}" font-size="{tfs}">{title}</text>')
        o.append(f'<text x="{cx}" y="{y+h/2+13}" text-anchor="middle" class="ds" font-size="{sfs}">{sub}</text>')
    elif title:
        o.append(f'<text x="{cx}" y="{y+h/2+4}" text-anchor="middle" class="{"dm" if mono else "dt"}" font-size="{tfs}">{title}</text>')
    return "".join(o)

def lines_box(x, y, w, h, title, rows, kind="n", dash=False, tfs=11, rfs=9.5, mono_rows=True):
    f, s = K[kind]
    d = ' stroke-dasharray="5 4"' if dash else ""
    o = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="5" fill="{f}" stroke="{s}" stroke-width="1.4"{d}/>']
    if title:
        o.append(f'<text x="{x+11}" y="{y+18}" class="dt" font-size="{tfs}">{title}</text>')
    yy = y + (36 if title else 20)
    for r in rows:
        cls = "dm" if mono_rows else "ds"
        if r.startswith("!"):
            o.append(f'<text x="{x+11}" y="{yy}" class="dbad" font-size="{rfs}">{r[1:]}</text>')
        elif r.startswith("+"):
            o.append(f'<text x="{x+11}" y="{yy}" class="dok" font-size="{rfs}">{r[1:]}</text>')
        else:
            o.append(f'<text x="{x+11}" y="{yy}" class="{cls}" font-size="{rfs}">{r}</text>')
        yy += 14
    return "".join(o)

def arrow(x1, y1, x2, y2, label="", kind="n", dash=False, fs=9.5, lo=-6, w=1.6, mid=None):
    col = {"n": FAINT, "a": ACC, "ok": OK, "w": WRN, "b": BAD, "c": BLU, "g": FAINT}[kind]
    mk = {"n": "af", "a": "aa", "ok": "ao", "w": "aw", "b": "ab", "c": "ac", "g": "af"}[kind]
    d = ' stroke-dasharray="5 4"' if dash else ""
    if mid is None:
        p = f"M {x1} {y1} L {x2} {y2}"
    else:
        p = f"M {x1} {y1} L {mid} {y1} L {mid} {y2} L {x2} {y2}"
    o = [f'<path d="{p}" fill="none" stroke="{col}" stroke-width="{w}"{d} marker-end="url(#{mk})"/>']
    if label:
        lx, ly = (x1 + x2) / 2, (y1 + y2) / 2 + lo
        o.append(f'<text x="{lx}" y="{ly}" text-anchor="middle" class="dl" font-size="{fs}" fill="{col}">{label}</text>')
    return "".join(o)

def txt(x, y, s, cls="ds", fs=10, anchor="start", fill=None):
    f = f' fill="{fill}"' if fill else ""
    return f'<text x="{x}" y="{y}" text-anchor="{anchor}" class="{cls}" font-size="{fs}"{f}>{s}</text>'

def pill(x, y, w, h, label, kind="b", fs=9.5):
    f, s = K[kind]
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h/2}" fill="{s}"/>'
            f'<text x="{x+w/2}" y="{y+h/2+3.4}" text-anchor="middle" class="dm" font-size="{fs}" fill="#ffffff">{label}</text>')

DEFS = "".join(
    f'<marker id="{i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">'
    f'<polygon points="0,0 10,5 0,10" fill="{c}"/></marker>'
    for i, c in (("af", FAINT), ("aa", ACC), ("ao", OK), ("aw", WRN), ("ab", BAD), ("ac", BLU)))

def fig(h, body, caption, w=700):
    return (f'<figure><div class="figbox"><svg viewBox="0 0 {w} {h}" role="img" class="dg">'
            f'<defs>{DEFS}</defs>{body}</svg></div>'
            f'<figcaption>{caption}</figcaption></figure>')

# ------------------------------------------------------------------- CSS ---
CSS = f"""
@page {{ size: A4; margin: 15mm 14mm 16mm 14mm; }}
@page {{ @bottom-center {{ content: counter(page); }} }}
* {{ box-sizing: border-box; }}
html {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
body {{ font-family:'IBM Plex Sans',ui-sans-serif,system-ui,sans-serif; font-size:9.6pt; line-height:1.52;
        color:{BODY}; background:#fff; margin:0; }}
h1,h2,h3,h4 {{ color:{INK}; margin:0; font-weight:600; letter-spacing:-.01em; }}
h1 {{ font-size:30pt; line-height:1.05; letter-spacing:-.025em; }}
h2 {{ font-size:17pt; line-height:1.16; }}
h3 {{ font-size:12.5pt; line-height:1.3; page-break-after:avoid; break-after:avoid; }}
h4 {{ font-size:10pt; }}
p {{ margin:0; }}
code {{ font-family:'IBM Plex Mono',ui-monospace,monospace; font-size:.88em; background:{RAIS};
        border:1px solid {LINE}; border-radius:3px; padding:.05em .3em; color:{INK}; }}
strong {{ color:{INK}; font-weight:600; }}
.stack {{ display:flex; flex-direction:column; gap:11px; }}
.eyebrow {{ font-family:'IBM Plex Mono',monospace; font-size:8pt; letter-spacing:.15em;
            text-transform:uppercase; color:{ACC}; font-weight:600; }}
.snum {{ font-family:'IBM Plex Mono',monospace; font-size:8pt; letter-spacing:.12em; color:{FAINT}; }}
.lede {{ font-size:11.5pt; line-height:1.5; color:{MUT}; }}
.rule {{ height:2px; background:{ACC}; width:34px; }}

/* cover */
.cover {{ height:250mm; display:flex; flex-direction:column; justify-content:space-between; page-break-after:always; }}
.cover-mid {{ display:flex; flex-direction:column; gap:16px; }}
.cover-meta {{ display:flex; flex-wrap:wrap; gap:7px; }}
.chip {{ font-family:'IBM Plex Mono',monospace; font-size:8pt; padding:4px 9px; border-radius:3px;
         border:1px solid {LINE}; color:{MUT}; background:{SURF}; }}
.chip.on {{ color:{ACC}; border-color:{ACC}; background:{ACCF}; }}

/* sections */
.sec {{ page-break-before:always; }}
.sechead {{ display:flex; flex-direction:column; gap:5px; margin-bottom:13px; }}
.prose {{ max-width:none; }}

/* figures */
figure {{ margin:0; display:flex; flex-direction:column; gap:7px; page-break-inside:avoid; }}
.figbox {{ background:#fff; border:1px solid {LINE}; border-radius:6px; padding:12px 12px 8px; }}
.dg {{ display:block; width:100%; height:auto; }}
figcaption {{ font-size:8.6pt; color:{MUT}; line-height:1.45; }}
figcaption b {{ color:{BODY}; }}
text {{ font-family:'IBM Plex Sans',sans-serif; }}
.dt {{ fill:{INK}; font-weight:600; }}
.ds {{ fill:{MUT}; }}
.dm {{ fill:{BODY}; font-family:'IBM Plex Mono',monospace; font-weight:500; }}
.dl {{ font-family:'IBM Plex Mono',monospace; font-weight:500; }}
.dbad {{ fill:{BAD}; font-family:'IBM Plex Mono',monospace; font-weight:500; }}
.dok {{ fill:{OK}; font-family:'IBM Plex Mono',monospace; font-weight:500; }}

/* blocks */
pre {{ font-family:'IBM Plex Mono',monospace; font-size:8.1pt; line-height:1.6; background:{SURF};
       border:1px solid {LINE}; border-radius:5px; padding:9px 11px; overflow:hidden;
       margin:0; color:{BODY}; white-space:pre-wrap; word-break:break-word; page-break-inside:avoid; }}
pre .c {{ color:{FAINT}; }}
.note {{ border-left:2.5px solid {ACC}; background:{ACCF}; padding:11px 13px; border-radius:0 4px 4px 0;
         display:flex; flex-direction:column; gap:5px; page-break-inside:avoid; }}
.note.w {{ border-left-color:{BAD}; background:{BADF}; }}
.note.g {{ border-left-color:{OK}; background:{OKF}; }}
.note h4 {{ font-family:'IBM Plex Mono',monospace; font-size:8pt; letter-spacing:.11em;
            text-transform:uppercase; color:{ACC}; }}
.note.w h4 {{ color:{BAD}; }} .note.g h4 {{ color:{OK}; }}

/* task */
.task {{ page-break-before:always; }}
.task-h {{ display:flex; align-items:flex-start; gap:11px; padding-bottom:9px;
           border-bottom:2px solid {ACC}; margin-bottom:12px; }}
.tid {{ font-family:'IBM Plex Mono',monospace; font-size:10pt; font-weight:600; color:#fff;
        background:{ACC}; padding:4px 9px; border-radius:4px; flex:none; }}
.task-h h2 {{ flex:1; }}
.fld {{ display:flex; flex-direction:column; gap:5px; page-break-inside:avoid; }}
.fld h5 {{ font-family:'IBM Plex Mono',monospace; font-size:7.8pt; letter-spacing:.13em;
           text-transform:uppercase; color:{ACC}; margin:0; font-weight:600; }}
.fld ol,.fld ul {{ margin:0; padding-left:17px; display:flex; flex-direction:column; gap:3px; }}
.dw {{ list-style:none; padding-left:0!important; }}
.dw li {{ position:relative; padding-left:18px; }}
.dw li::before {{ content:""; position:absolute; left:0; top:3px; width:10px; height:10px;
                  border:1.4px solid {OK}; border-radius:2px; }}
.ref {{ font-size:8.4pt; color:{FAINT}; border-top:1px solid {LINE}; padding-top:8px;
        display:flex; flex-direction:column; gap:3px; }}
.ref b {{ font-family:'IBM Plex Mono',monospace; font-size:7.6pt; letter-spacing:.1em;
          text-transform:uppercase; color:{FAINT}; font-weight:600; }}

/* prerequisite cards */
.pgrid {{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }}
.pcard {{ border:1px solid {LINE}; border-radius:6px; padding:9px 10px; background:{SURF};
          display:flex; flex-direction:column; gap:4px; page-break-inside:avoid; }}
.pcard .ph {{ display:flex; align-items:baseline; gap:7px; }}
.pcard h4 {{ flex:1; font-size:10.2pt; }}
.lvl {{ font-family:'IBM Plex Mono',monospace; font-size:7pt; letter-spacing:.07em; text-transform:uppercase;
        padding:2px 6px; border-radius:3px; font-weight:600; white-space:nowrap; }}
.lvl.e {{ background:{BAD}; color:#fff; }}
.lvl.h {{ background:{WRNF}; color:{WRN}; border:1px solid {WRN}; }}
.pcard dl {{ margin:0; display:flex; flex-direction:column; gap:3px; font-size:8.2pt; line-height:1.38; }}
.pcard dt {{ font-family:'IBM Plex Mono',monospace; font-size:7.4pt; letter-spacing:.08em;
             text-transform:uppercase; color:{FAINT}; font-weight:600; }}
.pcard dd {{ margin:0; color:{BODY}; }}
.pcard .chk {{ font-family:'IBM Plex Mono',monospace; font-size:7.8pt; color:{MUT};
               background:#fff; border:1px solid {LINE}; border-radius:3px; padding:4px 6px; }}
table {{ border-collapse:collapse; width:100%; font-size:8.8pt; }}
th {{ text-align:left; font-family:'IBM Plex Mono',monospace; font-size:7.6pt; letter-spacing:.1em;
      text-transform:uppercase; color:{FAINT}; font-weight:600; padding:7px 9px;
      border-bottom:1px solid {LINE}; background:{RAIS}; }}
td {{ padding:7px 9px; border-bottom:1px solid {LINE}; vertical-align:top; }}
.tw {{ border:1px solid {LINE}; border-radius:5px; overflow:hidden; page-break-inside:avoid; }}
.foot {{ border-top:1px solid {LINE}; margin-top:16px; padding-top:11px; font-size:8.4pt; color:{FAINT}; }}
"""

# ====================================================== architecture figure =
def fig_arch():
    b = []
    b.append(txt(6, 16, "THE SANDBOX, END TO END", "dl", 9.5, fill=ACC))
    b.append(lines_box(6, 30, 196, 156, "robot-agent  ·  terminal 3", [
        "publisher.py", "  1 string + 1 int, every second", "  drift-corrected · seq++",
        "mqtt_client.py", "  paho · QoS 0 · re-subscribes", "health_server.py  :8081"], "w"))
    b.append(box(238, 62, 150, 78, "mosquitto", "terminal 1  &#183;  :1884", "c"))
    b.append(lines_box(238, 160, 150, 82, "TOPICS", [
        "devices/{id}/string", "devices/{id}/int", "devices/{id}/cmd",
        "backend subs: +/string"], "n", rfs=8.6))
    b.append(lines_box(424, 30, 270, 156, "cloud/backend  ·  terminal 2  ·  :8001", [
        "mqtt/service.py   only broker toucher", "store.py   ReadingStore + Hub",
        "ws/stream.py   two live sockets", "api/   auth · data · health",
        "main.py   lifespan &#8594; app.state"], "c", rfs=8.8))
    b.append(box(424, 222, 128, 74, "Redis  :6380", "latest:{kind}", "ok", sfs=8.6))
    b.append(txt(488, 286, "history ring, 50", "dm", 8.2, "middle"))
    b.append(box(566, 222, 128, 74, "PostgreSQL  :5433", "string_readings", "ok", tfs=11, sfs=8.6))
    b.append(txt(630, 286, "int_readings", "dm", 8.2, "middle"))
    b.append(lines_box(424, 332, 270, 96, "browser  ·  terminal 4  ·  :3001", [
        "LoginPage.tsx   operator / demo1234", "RemoteDataPage.tsx   two windows",
        "useReadingSocket.ts   &#215;2, backoff,", "   detects gaps in seq"], "a", rfs=8.8))
    b.append(arrow(204, 100, 234, 100, "", "w"))
    b.append(txt(219, 90, "1 Hz", "dl", 8.2, "middle", fill=WRN))
    b.append(arrow(390, 100, 420, 100, "", "c"))
    b.append(txt(405, 84, "subscribes", "dl", 8.2, "middle", fill=BLU))
    b.append(txt(405, 94, "+/string", "dl", 8.2, "middle", fill=BLU))
    b.append(arrow(488, 190, 488, 218, "", "ok"))
    b.append(txt(494, 208, "SET / LPUSH", "dl", 8.4, fill=OK))
    b.append(arrow(630, 190, 630, 218, "", "ok"))
    b.append(txt(636, 208, "INSERT", "dl", 8.4, fill=OK))
    b.append(arrow(424, 170, 424, 380, "", "a", mid=404))
    b.append(txt(396, 262, "WS: backfill,", "dl", 8.6, "end", fill=ACC))
    b.append(txt(396, 274, "then live frames", "dl", 8.6, "end", fill=ACC))
    b.append(txt(6, 448, "five terminals you start yourself, plus Postgres as a background service &#183; every port sits one "
                         "above the main platform's, so both run at once &#183; 1884 / 6380 / 5433 / 8001 / 3001 / 8081", "ds", 8.6))
    return fig(456, "".join(b),
        "<b>One device, two data types, about 1,200 lines.</b> Four processes you start by hand, plus two background services. The architecture is the real one, not a toy: the same "
        "MQTT-only device boundary, the same Redis/Postgres split, the same &ldquo;one service owns the broker connection&rdquo; "
        "rule, and the same paho-thread-to-asyncio hand-off. What is missing is every security control &mdash; that is what "
        "the twelve exercises put back.")

# ======================================================== prerequisites =====
PREREQS = [
 ("Linux command line", "e",
  "Navigating a shell: files and paths, processes, pipes and redirection, reading logs, environment variables.",
  "There is no graphical interface anywhere in this system. Every service is started, inspected and debugged from a terminal, and the robot itself is reached over SSH.",
  "Constantly. <code>curl</code>, <code>grep</code>, <code>ss</code>, <code>psql</code>, <code>mosquitto_sub</code> &mdash; and every &ldquo;Verify&rdquo; step in this book is a shell command.",
  "grep -rn &quot;INTERN TASK&quot; secure_robotstore | wc -l"),

 ("Package managers &amp; virtual environments", "e",
  "Installing software with a package manager (<code>apt</code>, <code>brew</code>, <code>npm</code>), and keeping a project's Python packages in a <em>virtual environment</em> of its own.",
  "You will install and run five separate programs by hand &mdash; a broker, two databases, a Python backend and a Node frontend. Nothing is hidden behind an image, so what breaks is always something you can see and fix.",
  "Setup, and then daily. The system runs in four terminals; two of them must be inside the project's virtual environment or nothing imports.",
  "source .venv/bin/activate  ·  pip list  ·  npm ls --depth=0"),

 ("TCP/IP, ports &amp; sockets", "e",
  "How a process listens on a port, the difference between binding <code>127.0.0.1</code> and <code>0.0.0.0</code>, and how a packet finds its way between two machines.",
  "A large share of real vulnerabilities reduce to &ldquo;something was listening where nobody expected it&rdquo;. You cannot spot that without knowing what a listening socket is.",
  "Exercise 10 rebinds the databases and broker to loopback. Understanding why that matters &mdash; and why it is <em>not</em> enough on a robot sitting on campus Wi-Fi &mdash; is the point.",
  "ss -tlnp | grep -E '1884|5433|6380'"),

 ("MQTT publish / subscribe", "e",
  "A lightweight messaging protocol for devices: clients publish to named <em>topics</em>, a <em>broker</em> delivers to everyone subscribed. Nobody addresses anybody directly.",
  "MQTT is the only road between the cloud and the robot. Every command, every reading, every heartbeat crosses it &mdash; so it is also the single best place to enforce who may say what.",
  "Exercises 1, 2, 7 and 9 are all broker work. You will live inside <code>mosquitto_pub</code> and <code>mosquitto_sub</code>.",
  "mosquitto_sub -h localhost -p 1884 -t 'devices/#' -v"),

 ("HTTP &amp; REST", "e",
  "Request methods, status codes, headers and bodies &mdash; and the idea that the server decides, not the client.",
  "The operator API is HTTP. Status codes are how every access-control decision announces itself: 200 versus 401 versus 429 is the entire result of several exercises.",
  "Exercises 3, 5, 6 and 8. Exercise 8 is nothing but response headers.",
  "curl -s -o /dev/null -w '%{http_code}\\n' localhost:8001/api/int/latest"),

 ("WebSockets", "h",
  "A long-lived, two-way connection that starts as an HTTP request and is then upgraded, so the server can push data without being asked.",
  "Telemetry reaches the browser live rather than by polling. Sockets also break the usual authentication pattern, which is what makes exercise 5 interesting.",
  "Exercise 5. The crux: a browser cannot set custom headers on a WebSocket handshake, so <code>Authorization: Bearer</code> is simply unavailable to you.",
  "python3 -c &quot;import websockets&quot;  ·  then connect to /ws/int_api"),

 ("Python 3 &amp; asyncio", "e",
  "Reading and writing modern Python; <code>async</code>/<code>await</code>, the event loop, and the difference between a coroutine and a thread.",
  "Both the backend and the agent are asynchronous Python. More importantly, the single event loop is <em>why</em> one oversized message can stall every connected browser at once.",
  "Every code change you make. Exercise 7 cannot be understood at all without knowing what blocking the loop means.",
  "Read store.py and say what runs on which thread",),

 ("SQL &amp; PostgreSQL", "h",
  "Tables, queries, and parameterised statements &mdash; placeholders rather than string-concatenated values.",
  "Postgres is the system of record. It is also where you will prove that a forged message really did become a permanent row.",
  "Verification throughout. Exercise 3 adds a users table; exercise 12 adds the audit table. The existing inserts are parameterised on purpose &mdash; keep them that way.",
  "psql -h localhost -p 5433 -U robotstore -d robotstore -c '\\dt'"),

 ("Redis &amp; key-value thinking", "h",
  "An in-memory store with expiring keys and atomic operations such as <code>INCR</code>, <code>SETNX</code> and <code>GETDEL</code>.",
  "Anything that is live, countable or short-lived lives here: the latest reading, a login-attempt counter, a single-use ticket. Atomicity is what makes those correct under concurrency.",
  "Exercise 6's rate limiter is <code>INCR</code> plus <code>EXPIRE</code>. Exercise 5's ticket is <code>GETDEL</code> &mdash; read and delete in one operation, so it cannot be used twice.",
  "redis-cli -p 6380 KEYS '*'"),

 ("Cryptography fundamentals", "e",
  "The difference between <em>hashing</em> (one-way), <em>encryption</em> (reversible with a key) and <em>signing</em> (proves origin) &mdash; plus salts and constant-time comparison.",
  "Choosing the wrong one of the three is the most common serious mistake in this whole subject. &ldquo;We encrypt passwords&rdquo; is a sentence that describes a bug.",
  "Exercise 3 hashes. Exercise 4 signs. Exercise 9 encrypts. Being able to say which you need, and why, is more than half of each.",
  "Explain why bcrypt is deliberately slow and SHA-256 is not"),

 ("TLS &amp; certificates", "h",
  "How two parties agree on an encrypted channel, what a certificate authority vouches for, and how client certificates differ from server ones.",
  "Everything crosses a network you do not control. Without TLS, the credentials you add in exercise 1 travel in clear text and undo their own purpose.",
  "Exercise 9. The trap is mechanical: TLS must be configured <em>before</em> the socket is created, or it silently does nothing.",
  "openssl s_client -connect localhost:8883 -CAfile ca.crt"),

 ("Git &amp; reading unfamiliar code", "e",
  "Branches, commits, diffs and history &mdash; and the habit of reading a codebase you did not write before changing it.",
  "You will spend far more time reading than writing. Git history is also evidence: exercise 11 involves searching it for secrets that should never have been committed.",
  "Every exercise. Each one names a reference implementation in the main repository to compare your answer against &mdash; after you have attempted it.",
  "git log --oneline -20  ·  git log --all -p | grep -i password"),
]

def prereq_html():
    cards = []
    for name, lvl, what, why, where, chk in PREREQS:
        lab = "Essential" if lvl == "e" else "Helpful"
        cards.append(f"""<div class="pcard">
          <div class="ph"><h4>{name}</h4><span class="lvl {lvl}">{lab}</span></div>
          <dl><dt>What it is</dt><dd>{what}</dd>
              <dt>Why this system needs it</dt><dd>{why}</dd>
              <dt>Where you use it here</dt><dd>{where}</dd></dl>
          <div class="chk">&#8227; {chk}</div></div>""")
    return "\n".join(cards)

# ========================================================= task figures =====
def f1():
    b = [txt(6, 14, "WHO MAY CONNECT TO THE BROKER?", "dl", 9.5, fill=BAD)]
    for i, (lbl, sub, k) in enumerate((("robot-agent", "legitimate", "w"),
                                        ("backend", "legitimate", "c"),
                                        ("ATTACKER", "no credential at all", "b"))):
        b.append(box(6, 32 + i * 56, 152, 44, lbl, sub, k, sfs=8.6))
    b.append('<path d="M 232 22 L 232 74" stroke="%s" stroke-width="2" stroke-dasharray="4 4" fill="none"/>' % BAD)
    b.append('<path d="M 232 140 L 232 186" stroke="%s" stroke-width="2" stroke-dasharray="4 4" fill="none"/>' % BAD)
    b.append(txt(232, 206, "NO DOOR", "dbad", 11, "middle"))
    b.append(txt(232, 219, "allow_anonymous true", "dbad", 8.4, "middle"))
    for i in range(3):
        b.append(arrow(160, 54 + i * 56, 300, 106, "", ("w", "c", "b")[i]))
    b.append(box(302, 74, 140, 64, "mosquitto", "no password file", "c", sfs=8.6))
    b.append(lines_box(478, 36, 216, 140, "&#8230; and therefore", [
        "!forged reading &#8594; Redis",
        "!forged reading &#8594; Postgres, forever",
        "!pushed to every open browser",
        "!every topic readable by anyone",
        "!commands publishable to any device"], "b", rfs=8.6))
    b.append(arrow(444, 106, 474, 106, "", "b"))
    return fig(226, "".join(b),
        "<b>Exercise 1.</b> The broker asks nobody who they are. An attacker who can reach port 1884 is, as far as the "
        "system is concerned, exactly as trusted as the robot. Authentication is the foundation everything else rests on: "
        "an access-control list cannot scope a client to its own topics if the broker cannot tell clients apart.")

def f2():
    b = [txt(6, 14, "WHO MAY WRITE WHICH TOPIC?", "dl", 9.5, fill=BAD)]
    b.append(box(6, 58, 132, 76, "robot-agent", "authenticated", "w", sfs=8.6))
    b.append(box(562, 58, 132, 76, "backend", "authenticated", "c", sfs=8.6))
    b.append(arrow(142, 78, 556, 78, "", "ok"))
    b.append(txt(350, 70, "devices/{id}/string &#183; int   &#8212;   robot should be the only writer", "dl", 8.8, "middle", fill=OK))
    b.append(arrow(556, 118, 142, 118, "", "a"))
    b.append(txt(350, 110, "devices/{id}/cmd   &#8212;   backend should be the only writer", "dl", 8.8, "middle", fill=ACC))
    b.append('<path d="M 300 132 L 300 160" stroke="%s" stroke-width="1.6" stroke-dasharray="4 3" fill="none" marker-end="url(#ab)"/>' % BAD)
    b.append('<path d="M 400 92 L 400 160" stroke="%s" stroke-width="1.6" stroke-dasharray="4 3" fill="none" marker-end="url(#ab)"/>' % BAD)
    b.append(box(250, 162, 200, 42, "ANY authenticated client", "writes both directions", "b", tfs=10.5, sfs=8.6))
    b.append(lines_box(6, 150, 220, 54, "", ["!backend can forge telemetry", "!device can issue its own commands"], "b", rfs=8.6))
    b.append(lines_box(474, 150, 220, 54, "", ["!one stolen device key", "!  reaches every other device"], "b", rfs=8.6))
    return fig(216, "".join(b),
        "<b>Exercise 2.</b> Authentication proves <em>who</em>; it says nothing about <em>what they may do</em>. Without an "
        "ACL every authenticated client can write every topic &mdash; so a compromised backend can fabricate a robot's own "
        "self-reported state, and anything holding the device credential can command the whole fleet. Direction is the "
        "security property here.")

def f3():
    b = [txt(6, 14, "TWO WAYS THE LOGIN HELPS AN ATTACKER", "dl", 9.5, fill=BAD)]
    b.append(box(6, 66, 128, 56, "POST /auth/login", "", "n", tfs=10))
    b.append(arrow(138, 94, 172, 94, "", "n"))
    b.append(lines_box(174, 52, 176, 84, "_USERS = { &#8230; }", [
        "!&quot;operator&quot;: &quot;demo1234&quot;", "!&quot;viewer&quot;:  &quot;demo1234&quot;",
        "", "stored in plain text"], "b", rfs=8.6, tfs=10))
    b.append(arrow(352, 76, 390, 44, "", "b"))
    b.append(arrow(352, 112, 390, 144, "", "b"))
    b.append(box(392, 22, 190, 44, "&quot;No such user.&quot;", "username does not exist", "b", tfs=10.5, sfs=8.4))
    b.append(box(392, 122, 190, 44, "&quot;Wrong password.&quot;", "username DOES exist", "b", tfs=10.5, sfs=8.4))
    b.append(txt(596, 40, "free user", "dbad", 9, "start"))
    b.append(txt(596, 52, "enumeration", "dbad", 9, "start"))
    b.append(txt(596, 140, "and  ==  returns", "dbad", 9, "start"))
    b.append(txt(596, 152, "early, so timing", "dbad", 9, "start"))
    b.append(txt(596, 164, "leaks it too", "dbad", 9, "start"))
    b.append(txt(6, 186, "Fix both, or fixing one only moves the leak: identical messages still differ in how long they take to produce.",
                 "ds", 8.8))
    return fig(196, "".join(b),
        "<b>Exercise 3.</b> The endpoint answers a question it was never asked &mdash; &ldquo;does this account exist?&rdquo; &mdash; "
        "before any password is tried. Passwords are then compared with <code>==</code>, which stops at the first wrong "
        "character, so response timing carries the same information even after the messages are made identical.")

def f4():
    b = [txt(6, 14, "WHAT THE TOKEN ACTUALLY IS", "dl", 9.5, fill=BAD)]
    b.append(box(6, 44, 250, 52, "b3BlcmF0b3I6ZGVtbw==", "", "n", tfs=11, mono=True))
    b.append(txt(131, 110, "issued by the server on login", "ds", 8.6, "middle"))
    b.append(arrow(260, 70, 316, 70, "base64", "b", lo=-8))
    b.append(box(320, 44, 190, 52, "operator:demo", "", "b", tfs=12, mono=True))
    b.append(txt(415, 110, "&#8230; that is the whole secret", "dbad", 8.6, "middle"))
    b.append(lines_box(528, 34, 166, 74, "", ["!no signature", "!no expiry", "!never validated"], "b", rfs=9.2))
    b.append(box(6, 140, 504, 46, "python3 -c &quot;import base64; print(base64.b64encode(b'operator:demo').decode())&quot;",
                 "", "b", tfs=9.2, mono=True))
    b.append(txt(528, 160, "anyone can mint", "dbad", 9, "start"))
    b.append(txt(528, 172, "an operator session", "dbad", 9, "start"))
    return fig(200, "".join(b),
        "<b>Exercise 4.</b> This is not a token, it is a username in a costume &mdash; reversible by anyone, forgeable in one "
        "line, and valid forever because nothing in it says when it should stop being. A signature makes it unforgeable; an "
        "expiry bounds the damage of a stolen one; a unique id is what later makes revocation possible at all.")

def f5():
    b = [txt(6, 14, "THE GUARD IS IN THE WRONG PLACE", "dl", 9.5, fill=BAD)]
    b.append(box(6, 34, 132, 52, "Browser", "signed out", "a", sfs=8.6))
    b.append(arrow(142, 60, 196, 60, "", "a"))
    b.append(box(200, 32, 150, 56, "&lt;RequireAuth&gt;", "App.tsx route guard", "w", tfs=10.5, sfs=8.4, mono=True))
    b.append(arrow(354, 60, 408, 60, "redirect", "w", lo=-7))
    b.append(box(412, 34, 140, 52, "login screen", "UI hidden &#10003;", "ok", sfs=8.6))
    b.append('<path d="M 6 104 L 694 104" stroke="%s" stroke-width="1" stroke-dasharray="3 3" fill="none"/>' % LINE)
    b.append(box(6, 126, 132, 52, "curl / wscat", "no browser at all", "b", sfs=8.6))
    b.append('<path d="M 142 152 L 470 152" stroke="%s" stroke-width="2.2" fill="none" marker-end="url(#ab)"/>' % BAD)
    b.append(txt(300, 144, "straight past it &#8212; nothing to bypass, there is no server-side check", "dl", 9, "middle", fill=BAD))
    b.append(box(474, 126, 220, 52, "/api/&#8230;  and  /ws/&#8230;", "200 OK &#183; full data", "b", tfs=11, sfs=8.6, mono=True))
    b.append(txt(6, 198, "A route guard is a user-interface convenience. Authorisation is a decision only the server can make.",
                 "ds", 8.8))
    return fig(208, "".join(b),
        "<b>Exercise 5 &mdash; the one that matters most.</b> Exercises 3 and 4 are worth nothing without this: a perfectly "
        "hashed password and a perfectly signed token protect nothing if no endpoint ever checks the result. Note the "
        "WebSocket half is genuinely harder &mdash; a browser cannot set headers on the handshake, so a short-lived "
        "single-use ticket travels in the URL instead of the real token.")

def f6():
    b = [txt(6, 14, "GUESSING COSTS THE ATTACKER NOTHING", "dl", 9.5, fill=BAD)]
    b.append(box(6, 48, 140, 74, "attacker", "one script", "b", sfs=8.6))
    for i in range(9):
        y = 28 + i * 12
        b.append(f'<path d="M 150 {y+22} L 300 {y+22}" stroke="{BAD}" stroke-width="1" opacity="0.75"/>')
    b.append(txt(226, 40, "200 attempts / second", "dl", 8.8, "middle", fill=BAD))
    b.append(box(304, 48, 150, 74, "/auth/login", "no counter, no lockout", "b", tfs=11, sfs=8.4, mono=True))
    b.append(lines_box(470, 34, 224, 102, "after 60 seconds", [
        "!attempts  12,000", "!blocked        0", "!logged         0", "+lockout should start at ~5"], "b", rfs=9))
    b.append(txt(6, 158, "One shared operator credential means brute force <em>is</em> the attack surface a login endpoint has to defend.",
                 "ds", 8.8))
    return fig(170, "".join(b),
        "<b>Exercise 6.</b> A fixed window is the right amount of machinery here &mdash; this is one account being guessed "
        "at, not traffic shaping across millions of users. Choosing the simpler correct mechanism is part of the lesson. "
        "Watch the side effect: a rate limiter makes a test suite non-idempotent, which is how finding F9 was born.")

def f7():
    b = [txt(6, 14, "ONE BIG MESSAGE STOPS EVERYONE", "dl", 9.5, fill=BAD)]
    b.append(box(6, 40, 124, 56, "attacker", "5 MB payload", "b", sfs=8.6))
    b.append(arrow(134, 68, 176, 68, "", "b"))
    b.append(box(180, 40, 130, 56, "mosquitto", "no size limit", "c", sfs=8.6))
    b.append(arrow(314, 68, 356, 68, "", "b"))
    b.append(box(360, 34, 200, 68, "json.loads(payload)", "on the ONE event loop", "b", tfs=11, sfs=8.6, mono=True))
    b.append(lines_box(6, 118, 554, 72, "everything queued behind it, for as long as the parse takes", [
        "!browser 1 &#183; frozen      browser 2 &#183; frozen      browser 3 &#183; frozen",
        "!every other robot's telemetry &#183; waiting",
        "!health checks &#183; waiting  &#8594;  the container may be restarted under you"], "b", rfs=8.8, tfs=9.5))
    b.append(arrow(460, 106, 460, 114, "", "b"))
    b.append(lines_box(576, 34, 118, 156, "cap it at", [
        "+the broker", "+ before json.loads", "+ the value length",
        "", "three layers,", "each catching", "what the others", "cannot"], "ok", rfs=8.6, tfs=9.5))
    return fig(200, "".join(b),
        "<b>Exercise 7.</b> The backend parses every inbound message on the single asyncio event loop that serves every "
        "WebSocket client in the system. Derive the limit from the largest legitimate message rather than picking a round "
        "number &mdash; and verify by <em>delivery</em>, because <code>mosquitto_pub</code> exits 0 even when the broker "
        "silently drops the message.")

def f8():
    b = [txt(6, 14, "ANY SITE A SIGNED-IN STUDENT VISITS", "dl", 9.5, fill=BAD)]
    b.append(box(6, 40, 168, 76, "student's browser", "signed in to our console", "a", sfs=8.6))
    b.append(box(196, 40, 150, 76, "evil.example", "a page in another tab", "b", sfs=8.6))
    b.append(arrow(178, 78, 192, 78, "", "n"))
    b.append(arrow(350, 62, 440, 62, "fetch()", "b", lo=-7))
    b.append(box(444, 30, 168, 56, "our API", "Origin: evil.example", "c", sfs=8.6, mono=False))
    b.append(arrow(440, 104, 350, 104, "200 + data", "b", lo=-7))
    b.append(lines_box(444, 96, 250, 66, "response says", [
        "!Access-Control-Allow-Origin: *", "!  (no other security header at all)"], "b", rfs=8.6, tfs=9.5))
    b.append(txt(6, 182, "The headers that are missing &mdash; nosniff, frame-deny, CSP, referrer, no-store on the login response &mdash; "
                         "are each cheap, which is why skipping them is hard to justify later.", "ds", 8.8))
    return fig(192, "".join(b),
        "<b>Exercise 8.</b> A wildcard origin means the browser will hand our API's responses to any page the student "
        "happens to have open. Add an explicit allowlist &mdash; and for each header you add, write one sentence saying "
        "what attack it stops. If you cannot, do not add it: unexplained headers are cargo cult, not security.")

def f9():
    b = [txt(6, 14, "WHAT A LAPTOP ON THE SAME WI-FI SEES", "dl", 9.5, fill=BAD)]
    b.append(box(6, 56, 140, 60, "robot-agent", "", "w"))
    b.append(box(554, 56, 140, 60, "mosquitto", "", "c"))
    b.append(f'<path d="M 150 86 L 550 86" stroke="{FAINT}" stroke-width="2.4" fill="none"/>')
    b.append(txt(350, 78, "port 1884 &#183; plain TCP, no TLS", "dl", 9, "middle", fill=FAINT))
    b.append(f'<path d="M 350 90 L 350 120" stroke="{BAD}" stroke-width="1.6" stroke-dasharray="4 3" fill="none" marker-end="url(#ab)"/>')
    b.append(lines_box(196, 124, 308, 76, "tcpdump &#183; anyone on the network", [
        "!username: demo-device-01", "!password: &lt;the fleet password&gt;",
        "!devices/demo-device-01/int {&quot;value&quot;:47&#8230;}"], "b", rfs=8.6, tfs=9.5))
    b.append(txt(6, 216, "Exercise 1 gave every client a password. Without exercise 9 that password crosses the room in clear text on every "
                         "reconnect &#8212; and exercise 1 is undone.", "ds", 8.8))
    return fig(226, "".join(b),
        "<b>Exercise 9.</b> Encryption and authentication are not alternatives; either one without the other is a false "
        "sense of security. The trap in this task is mechanical rather than conceptual: paho applies TLS when the socket "
        "is created, so calling <code>tls_set()</code> after <code>connect_async()</code> silently does nothing and you get "
        "a plaintext connection that looks perfectly healthy.")

def f10():
    b = [txt(6, 14, "HOW BIG IS THE BLAST RADIUS?", "dl", 9.5, fill=BAD)]
    for i, (n, k) in enumerate((("backend", "c"), ("mosquitto", "w"), ("postgres", "ok"))):
        b.append(box(6 + i * 152, 34, 140, 62, n, "runs as YOUR account", k, sfs=8.6))
        b.append(txt(76 + i * 152, 110, "no memory limit", "dbad", 8.4, "middle"))
        b.append(txt(76 + i * 152, 122, "config world-readable", "dbad", 8.4, "middle"))
    b.append(lines_box(478, 34, 216, 100, "published on 0.0.0.0", [
        "!5433 &#8594; postgres", "!6380 &#8594; redis", "!1884 &#8594; mosquitto",
        "+only 8001 and 3001 need to be"], "b", rfs=8.8, tfs=9.5))
    b.append(box(6, 148, 200, 50, "a laptop elsewhere on the network", "", "b", tfs=9.6))
    b.append(arrow(210, 173, 470, 173, "psql -h &lt;your-ip&gt; -U robotstore", "b", lo=-7))
    b.append(box(474, 148, 220, 50, "your database", "no VPN, no firewall in the way", "b", tfs=10.5, sfs=8.4))
    return fig(210, "".join(b),
        "<b>Exercise 10.</b> These controls do not stop an intrusion; they bound what an intrusion becomes. A service "
        "compromised while running as your own account &mdash; with your source, your keys and your shell history in reach, "
        "and its port open to the whole network &mdash; is a very different incident from one running as a dedicated user, "
        "memory-capped, listening only on loopback. Same principle the real stack applies with containers; here you apply "
        "it directly.")

def f11():
    b = [txt(6, 14, "EVERY DEPLOYMENT SHARES ONE PASSWORD", "dl", 9.5, fill=BAD)]
    b.append(lines_box(6, 32, 210, 92, ".env.example   (committed)", [
        "POSTGRES_USER=robotstore", "!POSTGRES_PASSWORD=robotstore"], "n", rfs=8.8, tfs=9.5))
    b.append(lines_box(246, 32, 210, 92, ".env   (in use)", [
        "POSTGRES_USER=robotstore", "!POSTGRES_PASSWORD=robotstore"], "n", rfs=8.8, tfs=9.5))
    b.append(txt(231, 84, "=", "dbad", 20, "middle"))
    b.append(txt(480, 62, "byte for byte", "dbad", 9.4, "start"))
    b.append(txt(480, 76, "identical &#8212; the", "dbad", 9.4, "start"))
    b.append(txt(480, 90, "example file is", "dbad", 9.4, "start"))
    b.append(txt(480, 104, "the real one", "dbad", 9.4, "start"))
    for i, n in enumerate(("school A", "school B", "school C")):
        b.append(box(6 + i * 152, 146, 140, 48, n, "same credentials", "b", tfs=10.5, sfs=8.4))
    b.append(lines_box(478, 140, 216, 60, "", [
        "+generate per environment", "+refuse to boot on a default", "+  when ENVIRONMENT=production"], "ok", rfs=8.6))
    return fig(208, "".join(b),
        "<b>Exercise 11.</b> The half people skip is the startup guard, and it is the half that works. A default credential "
        "which only fails at code-review time will eventually reach production, because review is a human process that "
        "misses things; one that refuses to boot cannot. Check git history too &mdash; anything already committed is "
        "exposed and must be rotated, not merely deleted.")

def f12():
    b = [txt(6, 14, "CAN YOU PROVE THE RECORD WAS NOT EDITED?", "dl", 9.5, fill=BAD)]
    b.append(txt(6, 36, "TODAY &#8212; a line in the application log", "dl", 9, fill=BAD))
    b.append(box(6, 44, 320, 40, "logger.info(&quot;login ok: operator&quot;)", "", "b", tfs=9.4, mono=True))
    b.append(arrow(330, 64, 372, 64, "edit", "b", lo=-7))
    b.append(box(376, 44, 318, 40, "logger.info(&quot;login ok: someone-else&quot;)", "", "b", tfs=9.4, mono=True))
    b.append(txt(350, 100, "no trace, no evidence, and gone at the next log rotation anyway", "ds", 8.8, "middle"))
    b.append(f'<path d="M 6 118 L 694 118" stroke="{LINE}" stroke-width="1" stroke-dasharray="3 3" fill="none"/>')
    b.append(txt(6, 142, "HASH-CHAINED &#8212; every entry commits to the one before it", "dl", 9, fill=OK))
    for i in range(5):
        x = 6 + i * 140
        k = "b" if i == 2 else ("w" if i > 2 else "ok")
        b.append(box(x, 152, 124, 46, f"entry {i+1}", "sha256(prev + row)", k, tfs=10, sfs=7.8))
        if i < 4:
            b.append(arrow(x + 126, 175, x + 138, 175, "", "ok" if i < 2 else "b"))
    b.append(txt(202, 216, "edit this one &#8230;", "dbad", 8.8, "middle"))
    b.append(txt(492, 216, "&#8230; and every hash after it stops matching", "dbad", 8.8, "middle"))
    return fig(226, "".join(b),
        "<b>Exercise 12.</b> After an incident involving a machine that moved, the first question is who commanded it. "
        "Chaining each entry to the hash of the previous one makes tampering detectable by recomputation alone. Two details "
        "carry the weight: canonical serialisation with sorted keys, so identical data always hashes identically, and a "
        "database advisory lock around appends, so two concurrent writers cannot both chain from the same predecessor.")

# ============================================================ task content ==
DR = ""   # native mosquitto clients — no container wrapper needed

TASKS = [
(1, "MQTT authentication", f1,
 "<code>mosquitto/mosquitto.conf</code> sets <code>allow_anonymous true</code>. Any client that can open a TCP "
 "connection to the broker is a trusted client, and there are no credentials anywhere in this stack to check.",
 f"{DR}mosquitto_pub -h localhost -p 1884 -t devices/demo-device-01/int \\\n    -m '{{\"value\":999,\"seq\":999999}}'\n\n"
 "<span class=\"c\"># no credential was offered — and it is now in the system of record</span>\n"
 "psql -h localhost -p 5433 -U robotstore -d robotstore \\\n  -c \"SELECT * FROM int_readings WHERE seq = 999999;\"",
 ["Anonymous publish and subscribe are both refused by the broker.",
  "The agent and the backend hold <em>separate</em> credentials, and both still work.",
  "No password appears in any committed file or anywhere in git history.",
  "A wrong credential produces a clear log line rather than silence."],
 "<span class=\"c\"># must now fail</span>\n"
 f"{DR}mosquitto_pub -h localhost -p 1884 -t devices/demo-device-01/int -m '{{\"value\":1}}'\n\n"
 "<span class=\"c\"># must still be true — the real clients are unaffected</span>\n"
 "curl -s localhost:8001/health/detail | python3 -m json.tool\ncurl -s localhost:8081",
 [("Watch for", "paho retries forever in the background, so a wrong password looks like silence rather than an error. Read the broker log."),
  ("Compare against", "<code>cloud-container/mosquitto/</code> — note how <code>docker-entrypoint-wrapper.sh</code> generates the password file at container start so no plaintext ever enters git.")]),

(2, "MQTT topic ACLs", f2,
 "With no <code>acl_file</code>, every authenticated client may publish and subscribe to everything. A compromised "
 "backend can forge device telemetry, and anything holding the agent's credential can publish commands back to the device.",
 "<span class=\"c\"># with exercise 1 done, connect as the BACKEND and publish device telemetry.</span>\n"
 "<span class=\"c\"># it succeeds — and it should not: the backend has no business claiming to be a device.</span>\n"
 f"{DR}mosquitto_pub -h localhost -p 1884 -u backend -P \"$MQTT_BACKEND_PASSWORD\" \\\n"
 "    -t devices/demo-device-01/string -m '{\"value\":\"forged\",\"seq\":1}'",
 ["The backend identity cannot publish telemetry, status or health.",
  "The device identity cannot publish to the command topic.",
  "Neither identity can subscribe to a topic outside its role.",
  "Real telemetry and real commands both still flow."],
 "<span class=\"c\"># both of these must now be refused</span>\n"
 "mosquitto_pub -h localhost -p 1884 -u backend -P \"$MQTT_BACKEND_PASSWORD\" \\\n"
 "  -t devices/demo-device-01/string -m '{\"value\":\"forged\"}'\n"
 "mosquitto_pub -h localhost -p 1884 -u demo-device-01 -P \"$MQTT_DEVICE_PASSWORD\" \\\n"
 "  -t devices/demo-device-01/cmd -m '{\"action\":\"drive\"}'",
 [("Steal this trick", "Use a <code>pattern</code> rule with <code>%u</code> so each device is scoped to its own namespace automatically. Onboarding device #2 then means issuing a credential, not editing the ACL file."),
  ("Compare against", "<code>cloud-container/mosquitto/aclfile</code>")]),

(3, "Real credential checking", f3,
 "<code>cloud/backend/app/api/auth.py</code> holds a dictionary of plaintext passwords in source, compares them with "
 "<code>==</code>, and returns a different error for &ldquo;no such user&rdquo; than for &ldquo;wrong password&rdquo;.",
 "curl -s -X POST localhost:8001/auth/login -H 'Content-Type: application/json' \\\n"
 "  -d '{\"username\":\"operator\",\"password\":\"wrong\"}'   <span class=\"c\"># \"Wrong password.\"</span>\n"
 "curl -s -X POST localhost:8001/auth/login -H 'Content-Type: application/json' \\\n"
 "  -d '{\"username\":\"nobody\",\"password\":\"wrong\"}'     <span class=\"c\"># \"No such user.\"</span>",
 ["Both failing requests return byte-identical responses.",
  "Passwords are stored hashed with bcrypt or argon2 — never a bare SHA.",
  "The comparison is constant-time, on <em>both</em> fields.",
  "A failure costs the same work when the user does not exist, so the timing leak does not return through the skipped hash."],
 "<span class=\"c\"># identical bodies…</span>\n"
 "for u in operator nobody; do\n"
 "  curl -s -X POST localhost:8001/auth/login -H 'Content-Type: application/json' \\\n"
 "    -d \"{\\\"username\\\":\\\"$u\\\",\\\"password\\\":\\\"x\\\"}\"; echo\n"
 "done\n\n<span class=\"c\"># …and indistinguishable timing</span>\n"
 "for u in operator nobody; do\n"
 "  curl -s -o /dev/null -w \"$u %{time_total}\\n\" -X POST localhost:8001/auth/login \\\n"
 "    -H 'Content-Type: application/json' -d \"{\\\"username\\\":\\\"$u\\\",\\\"password\\\":\\\"x\\\"}\"\n"
 "done",
 [("A caveat on the target", "The reference file checks one configured credential rather than a users table; its own docstring calls a table with hashed passwords the natural extension. Either is a legitimate answer here."),
  ("Compare against", "<code>cloud-container/backend/app/auth/service.py</code>")]),

(4, "Real tokens", f4,
 "The token is <code>base64(username + \":demo\")</code>. It is not signed, so anyone can mint one, and it carries no "
 "expiry, so it is valid forever.",
 "python3 -c \"import base64; print(base64.b64encode(b'operator:demo').decode())\"\n\n"
 "<span class=\"c\"># that is the exact string the server issues — you just minted an</span>\n"
 "<span class=\"c\"># operator session without touching the server</span>",
 ["A token with a tampered payload is rejected.",
  "A token past its <code>exp</code> is rejected, without a restart.",
  "Signing and verification are pure functions, unit-testable without starting the app.",
  "The signing secret comes from the environment, and the app refuses to start on a known default."],
 "<span class=\"c\"># pair this with exercise 5 — until a route validates, nothing here is observable</span>\n"
 "curl -s -o /dev/null -w \"%{http_code}\\n\" localhost:8001/api/int/latest \\\n"
 "  -H \"Authorization: Bearer $FORGED\"      <span class=\"c\"># expect 401</span>",
 [("Go one step further", "Add a <code>jti</code> claim and a Redis revocation list. A JWT is stateless and so cannot be cancelled before it expires; <code>jti</code> is the handle that makes logout actually invalidate a session."),
  ("Compare against", "<code>cloud-container/backend/app/auth/tokens.py</code>")]),

(5, "Protecting the endpoints", f5,
 "Nothing checks the token. Every REST route in <code>api/data.py</code> and both WebSockets in <code>ws/stream.py</code> "
 "serve anyone. The route guard in <code>App.tsx</code> hides the interface and protects nothing. <strong>Exercises 3 and 4 "
 "are worth nothing on their own</strong> &mdash; a perfect token nobody validates is still a perfect token nobody validates.",
 "curl -s -o /dev/null -w \"history -> %{http_code}\\n\" localhost:8001/api/string/history\n\n"
 "python3 - &lt;&lt;'PY'\n"
 "import asyncio, websockets\n"
 "async def main():\n"
 "    async with websockets.connect(\"ws://localhost:8001/ws/int_api\") as ws:\n"
 "        print(\"connected with no token:\", (await ws.recv())[:60])\n"
 "asyncio.run(main())\nPY",
 ["Every REST route returns 401 without a valid token.",
  "Both WebSocket upgrades are refused before <code>accept()</code>, not after.",
  "A ticket cannot be used twice, and expires on its own.",
  "The browser still works end to end: log in, both windows live."],
 "<span class=\"c\"># both must fail before a token and succeed after</span>\n"
 "curl -s -o /dev/null -w \"%{http_code}\\n\" localhost:8001/api/string/history\n"
 "<span class=\"c\"># and the same ticket must be rejected the second time it is used</span>",
 [("The real constraint", "Browsers cannot set custom headers on a WebSocket handshake, so <em>something</em> must travel in the URL. A token there ends up in proxy and access logs — so issue a 15-second single-use ticket instead, consumed atomically with <code>GETDEL</code>."),
  ("Compare against", "<code>cloud-container/backend/app/auth/dependencies.py</code>")]),

(6, "Login rate limiting", f6,
 "<code>/auth/login</code> can be tried as fast as the network allows. There is no counter, no lockout and no record.",
 "time for i in $(seq 1 200); do\n"
 "  curl -s -o /dev/null -X POST localhost:8001/auth/login \\\n"
 "    -H 'Content-Type: application/json' \\\n"
 "    -d '{\"username\":\"operator\",\"password\":\"guess'\"$i\"'\"}'\ndone",
 ["Repeated failures trigger a lockout that expires on its own.",
  "A correct password during the lockout is <em>also</em> refused — and you can explain why that is correct.",
  "A successful login clears both keys.",
  "The existing test suite passes, or the reason it changed is written down."],
 "for i in $(seq 1 30); do\n"
 "  curl -s -o /dev/null -w \"%{http_code} \" -X POST localhost:8001/auth/login \\\n"
 "    -H 'Content-Type: application/json' \\\n"
 "    -d \"{\\\"username\\\":\\\"operator\\\",\\\"password\\\":\\\"guess$i\\\"}\"\n"
 "done; echo\n<span class=\"c\"># expect 401s, then 429s from the threshold onward</span>",
 [("Choose the numbers deliberately", "Consider a classroom of thirty students mistyping passwords behind one NAT address. Write down your reasoning for the threshold and the durations."),
  ("Watch for", "A rate limiter makes a test suite non-idempotent — that was finding F9, caused by this exact fix.")]),

(7, "Input size limits", f7,
 "Two places accept unbounded input: <code>mqtt/service.py</code> calls <code>json.loads()</code> on whatever arrives "
 "with no size check, and <code>store.py</code> writes a string reading of any length to Postgres, Redis and every open "
 "browser. <code>mosquitto.conf</code> sets no <code>message_size_limit</code> either.",
 "python3 -c \"print('{\\\"value\\\":\\\"' + 'A'*5000000 + '\\\",\\\"seq\\\":424242}')\" &gt; /tmp/huge.json\n"
 f"{DR}mosquitto_pub -h localhost -p 1884 -t devices/demo-device-01/string -f /tmp/huge.json\n\n"
 "<span class=\"c\"># watch the UI while that lands — the parse runs on the single event</span>\n"
 "<span class=\"c\"># loop serving every WebSocket client, so one message stalls everyone</span>",
 ["An oversized publish is dropped and never reaches Postgres.",
  "Normal readings keep flowing throughout the attack.",
  "Limits exist at all three layers: broker, pre-parse byte cap, and value length.",
  "A test covers the exact boundary, and another asserts the ceiling itself stays sane."],
 "<span class=\"c\"># verify by DELIVERY — mosquitto_pub exits 0 even when the broker drops it</span>\n"
 "psql -h localhost -p 5433 -U robotstore -d robotstore \\\n"
 "  -c \"SELECT count(*) FROM string_readings WHERE seq = 424242;\"   <span class=\"c\"># must be 0</span>\n"
 "curl -s localhost:8001/health/detail    <span class=\"c\"># backend still healthy</span>",
 [("Derive, do not guess", "Work the limit out from the largest legitimate message. The main repo's comment reasons from a LiDAR scan (~8 KB) and an SDP offer (~6 KB) to a 256 KB ceiling."),
  ("Compare against", "<code>cloud-container/backend/app/mqtt/service.py</code> and the <code>message_size_limit</code> block in <code>cloud-container/mosquitto/mosquitto.conf</code>")]),

(8, "CORS and security headers", f8,
 "<code>CORS_ALLOWED_ORIGINS</code> is <code>\"*\"</code>, so any site a signed-in user visits can call this API from "
 "their browser. Neither the API nor nginx sets a single security header.",
 "curl -sI localhost:8001/health | grep -iE 'x-frame|x-content|content-security|referrer' \\\n"
 "  || echo \"no security headers at all\"\n"
 "curl -s -o /dev/null -w \"%{http_code}\\n\" -H \"Origin: https://evil.example\" \\\n"
 "  localhost:8001/api/int/latest",
 ["The <code>evil.example</code> origin is refused; <code>http://localhost:3001</code> still works.",
  "Headers are present on both the API and the frontend host.",
  "Login responses carry <code>Cache-Control: no-store</code>.",
  "A one-line justification exists for every header you added."],
 "curl -sI localhost:8001/health | grep -iE 'x-frame|x-content|content-security|permissions'\n"
 "curl -sI localhost:3001/       | grep -iE 'x-frame|x-content|content-security'",
 [("Know what each one does", "Never combine a wildcard origin with credentialed requests — find out what browsers do with that combination and why."),
  ("Compare against", "<code>cloud-container/backend/app/security_headers.py</code>, <code>cloud-container/frontend/nginx.conf</code>")]),

(9, "TLS everywhere", f9,
 "Every hop is plaintext: MQTT on 1884, Postgres, Redis, and HTTP at the edge. Exercise 2 already proved the broker half "
 "&mdash; and once exercise 1 is done, an eavesdropper reads the <em>credentials</em> off the wire on every connect.",
 f"{DR}mosquitto_sub -h localhost -p 1884 -t 'devices/#' -v\n\n"
 "<span class=\"c\"># or, from anywhere on the network path:</span>\n"
 "sudo tcpdump -i any -A -c 40 'port 1884' | grep 'devices/'",
 ["Both clients connect over 8883; the plaintext listener is closed or restricted.",
  "A packet capture on the TLS port shows no readable topic names or payloads.",
  "An untrusted certificate is rejected, with a log line saying so — never silently downgraded.",
  "The port and TLS mode are configuration, not code."],
 "sudo tcpdump -i any -A -c 40 'port 1884' | grep -c 'devices/'\n"
 "sudo tcpdump -i any -A -c 40 'port 8883' | grep -c 'devices/'    <span class=\"c\"># expect 0</span>",
 [("The mechanical trap", "paho applies TLS when the socket is created, so <code>tls_set()</code> must be called <em>before</em> <code>connect_async()</code>. Call it after and it silently does nothing."),
  ("Compare against", "<code>scripts/generate-dev-certs.sh</code>, and the <code>mqtt_tls_*</code> settings in <code>cloud-container/backend/app/config.py</code>")]),

(10, "Service hardening", f10,
 "Everything you started runs as <em>you</em> &mdash; your login account, with access to every file you own. "
 "Redis and Postgres were installed with defaults, no memory limit is set anywhere, and the broker binds every "
 "network interface rather than just loopback.",
 "whoami                                 <span class=\"c\"># the backend runs as this account</span>\n"
 "ss -tlnp | grep -E '1884|5433|6380'    <span class=\"c\"># bound on 0.0.0.0, not 127.0.0.1</span>\n\n"
 "<span class=\"c\"># from another machine on the same network, this reaches your database:</span>\n"
 "psql -h &lt;this-host&gt; -p 5433 -U robotstore -d robotstore",
 ["The broker, Redis and Postgres accept connections only from <code>127.0.0.1</code>.",
  "No service runs as root, and none runs as an account that owns your source code.",
  "Config files holding credentials are readable only by their owner.",
  "A memory limit exists for each service, derived from a measurement rather than a guess."],
 "ss -tlnp | grep -E '1884|5433|6380'    <span class=\"c\"># expect 127.0.0.1, never 0.0.0.0</span>\n"
 "ps -o user=,cmd= -C mosquitto -C redis-server    <span class=\"c\"># expect a dedicated user</span>\n"
 "ls -l mosquitto/passwordfile                     <span class=\"c\"># expect -rw------- </span>",
 [("Expect breakage", "Narrowing a bind address or changing a service user usually breaks something that was quietly relying on the looser setting. Fix it properly rather than by widening the permission again."),
  ("The same idea, containerised", "The real stack solves this with non-root <code>USER</code> directives, <code>no-new-privileges</code> and loopback-only port publishing &mdash; see the root <code>docker-compose.yml</code> and <code>cloud-container/docker/backend.Dockerfile</code>. The principles are identical; only the mechanism differs.")]),

(11, "Secrets", f11,
 "<code>.env</code> and <code>.env.example</code> are identical, and both contain <code>POSTGRES_PASSWORD=robotstore</code>. "
 "<code>local.env</code> reuses those defaults verbatim, so every copy of this project shares credentials with every other.",
 "diff .env .env.example && echo \"identical — the example file IS the real one\"\n\n"
 "<span class=\"c\"># and check whether anything sensitive was ever committed</span>\n"
 "git log --all -p | grep -iE 'password|secret|api[_-]?key' | grep -v 'example'",
 ["A fresh checkout cannot start without generating secrets first.",
  "A production start carrying any known default fails loudly, naming the setting.",
  "Local development still starts with no manual steps beyond the generator.",
  "Git history has been checked, and anything found is <em>rotated</em>, not just deleted."],
 "ENVIRONMENT=production POSTGRES_PASSWORD=robotstore \\\n"
 "  uvicorn app.main:app --port 8001\n"
 "<span class=\"c\"># expect: immediate exit, naming POSTGRES_PASSWORD as an insecure default</span>",
 [("The half people skip", "A default that only fails at code review will eventually reach production. One that refuses to boot cannot."),
  ("Compare against", "<code>scripts/generate-secrets.sh</code>, and <code>assert_production_safe()</code> with its <code>_INSECURE_DEFAULTS</code> set in <code>cloud-container/backend/app/config.py</code>")]),

(12, "Audit logging", f12,
 "Auth events reach <code>logger.info()</code> and nothing else. That is neither durable — log rotation, a restarted "
 "container — nor tamper-evident: anyone with disk access edits it leaving no trace. For a system that drives physical "
 "hardware, &ldquo;who commanded what, when&rdquo; has to survive an incident review.",
 "<span class=\"c\"># look at terminal 2, where the backend is running</span>\n"
 "grep 'login ok' &lt;whatever you scrolled past in that terminal&gt;\n\n"
 "<span class=\"c\"># now ask: where does this live in an hour? who could have edited it?</span>\n"
 "<span class=\"c\"># what would prove that nobody did?</span>",
 ["Log in, log out and fail a login — all three appear, with actor, action, result and time.",
  "The verifier passes on an untouched chain.",
  "A single edited, deleted or reordered row is detected <em>and located</em>.",
  "Concurrent writes do not corrupt the chain under load."],
 "python3 scripts/verify-audit-log.py          <span class=\"c\"># chain intact, N entries</span>\n\n"
 "psql -h localhost -p 5433 -U robotstore -d robotstore \\\n"
 "  -c \"UPDATE audit_log SET actor='someone-else' WHERE id = 5;\"\n\n"
 "python3 scripts/verify-audit-log.py          <span class=\"c\"># break detected at entry 5</span>",
 [("Two details carry the weight", "Canonical JSON with sorted keys, so identical data always hashes identically; and a Postgres advisory lock around appends, so two concurrent writers cannot both chain from the same predecessor."),
  ("Compare against", "<code>cloud-container/backend/app/audit/logger.py</code>")]),
]

def task_html(t):
    num, title, figfn, wrong, prove, done, verify, refs = t
    dl = "".join(f"<li>{d}</li>" for d in done)
    rf = "".join(f"<p><b>{a}</b> &nbsp;{c}</p>" for a, c in refs)
    return f"""<section class="task">
  <div class="task-h"><span class="tid">{num:02d}</span><h2>{title}</h2></div>
  <div class="stack">
    {figfn()}
    <div class="fld"><h5>What is wrong</h5><p>{wrong}</p></div>
    <div class="fld"><h5>Prove it first</h5><pre>{prove}</pre></div>
    <div class="fld"><h5>Done looks like</h5><ul class="dw">{dl}</ul></div>
    <div class="fld"><h5>Verify the fix</h5><pre>{verify}</pre></div>
    <div class="ref">{rf}</div>
  </div>
</section>"""

# ================================================================ assemble ==
COVER = f"""<div class="cover">
  <div>
    <p class="eyebrow">secure_robotstore &middot; training sandbox</p>
  </div>
  <div class="cover-mid">
    <div class="rule"></div>
    <h1>The Twelve<br>Exercises</h1>
    <p class="lede">Put the security back into a deliberately insecure cloud&#8209;robotics stack &mdash;
    one control at a time, each one proved before it is fixed and proved again afterwards.</p>
    <div class="cover-meta">
      <span class="chip on">12 exercises</span>
      <span class="chip">Prerequisites &amp; skills</span>
      <span class="chip">Setup &amp; run, no Docker</span>
      <span class="chip">Architecture overview</span>
      <span class="chip">One infographic per exercise</span>
    </div>
  </div>
  <div>
    <p style="font-size:8.6pt;color:{FAINT};line-height:1.5">
    Companion to <code>secure_robotstore/README.md</code>. Every exercise has a working reference implementation
    in the main repository, named on its own page &mdash; read it <em>after</em> your attempt, not before.<br>
    Nothing in this sandbox is secure. That is the point.</p>
  </div>
</div>"""

METHOD = f"""<section class="sec">
  <div class="sechead"><div class="rule"></div><p class="snum">00</p><h2>How to work through this</h2></div>
  <div class="stack">
    <p class="lede">Read this page once. It is the difference between applying security controls you half-understand
    and applying the right ones, in the right place, for the right reason.</p>

    <div class="note"><h4>The method &mdash; three steps, never two</h4>
      <p><strong>Prove it. Fix it. Prove it again.</strong> Every exercise opens with a command that demonstrates the
      weakness against the running stack, and closes with that same command failing. A fix you cannot demonstrate is a
      fix nobody can trust &mdash; and several of the weaknesses here are completely invisible from the user interface.
      If you cannot show the before, you have not earned the after.</p></div>

    <div class="stack">
      <h3>Three rules that apply to every exercise</h3>
      <p><strong>1 &middot; Keep the application working.</strong> A security change that silently stops the data
      flowing is not a pass. The most common way to fail these is to lock out the <em>legitimate</em> clients along
      with the attacker &mdash; remember that the agent and the backend are MQTT clients too. After every change:</p>
      <pre><span class="c"># restart whichever terminal you changed — broker, backend or agent — then:</span>
curl -s localhost:8001/health/detail | python3 -m json.tool
<span class="c"># then open http://localhost:3001 — both windows should still tick at 1 Hz</span></pre>
      <p><strong>2 &middot; Read the reference implementation afterwards, not before.</strong> Every exercise names a
      file in the main repository that solves the same problem properly. The point is to arrive at the reasoning
      yourself; the comparison is the check on it, and it is much more useful once you have something to compare.</p>
      <p><strong>3 &middot; Match the reasoning, not the line count.</strong> The main stack solves these at fleet scale
      &mdash; many robots, per-device identities, token revocation, hash-chained audit. This sandbox has one device and
      two data types. Where the reference is more elaborate than this needs, its own docstring usually says why.</p>
    </div>

    <div class="note w"><h4>Before your first command</h4>
      <p>Everything here runs against the sandbox on your own machine. Nothing in this book is ever run against a
      production deployment, against a robot that can move while a person is within reach, or against any system you
      have not been given written authorisation to test. If you find something that reaches outside the sandbox,
      that is the moment to stop and tell someone &mdash; not the moment to confirm it.</p></div>

    <div class="stack">
      <h3>The suggested order &mdash; and why it is this order</h3>
      <div class="tw"><table>
        <tr><th style="width:26px">#</th><th>Exercise</th><th>Why it comes here</th></tr>
        <tr><td>1</td><td>MQTT authentication</td><td>Nothing else can be scoped until the broker can tell clients apart.</td></tr>
        <tr><td>2</td><td>MQTT topic ACLs</td><td>Identity without authorisation still lets any client write any topic.</td></tr>
        <tr><td>3</td><td>Credential checking</td><td>The operator half of identity; small code, large consequence.</td></tr>
        <tr><td>4</td><td>Real tokens</td><td>A credential check is only useful if the resulting session is unforgeable.</td></tr>
        <tr><td>5</td><td>Protecting endpoints</td><td><strong>The one that matters most.</strong> 3 and 4 are worth nothing without it.</td></tr>
        <tr><td>6</td><td>Login rate limiting</td><td>Now that the login is correct, make guessing at it expensive.</td></tr>
        <tr><td>7</td><td>Input size limits</td><td>Availability: one client must not be able to stall everyone.</td></tr>
        <tr><td>8</td><td>CORS &amp; headers</td><td>The browser-facing edge, cheap to fix and hard to justify skipping.</td></tr>
        <tr><td>9</td><td>TLS</td><td>Protects the credentials added in 1 &mdash; without it, 1 is undone on every connect.</td></tr>
        <tr><td>10</td><td>Container hardening</td><td>Bounds what any successful intrusion is able to become.</td></tr>
        <tr><td>11</td><td>Secrets</td><td>Stops a known-default credential ever reaching a real deployment.</td></tr>
        <tr><td>12</td><td>Audit logging</td><td>When prevention eventually fails, this is what lets you reconstruct it.</td></tr>
      </table></div>
    </div>
  </div>
</section>"""

PREREQ_SEC = f"""<section class="sec">
  <div class="sechead"><div class="rule"></div><p class="snum">01</p><h2>Prerequisites &amp; skills</h2></div>
  <div class="stack">
    <p class="lede">What you need to know before starting, why this particular system needs it, and where each skill
    shows up in the exercises. Nobody is expected to arrive strong in all twelve.</p>
    <p><strong>Essential</strong> means an exercise will be confusing without it. <strong>Helpful</strong> means you can
    learn it as you go, on the exercise that needs it. If you are missing something marked essential, say so at the start
    &mdash; a day spent closing the gap is cheaper than three weeks of working around it. The line under each card is a
    quick way to check yourself.</p>
    <div class="pgrid">{prereq_html()}</div>
    <div class="note g"><h4>What none of these can be replaced by</h4>
      <p>The habit of <strong>not believing anything you have not checked</strong>. Every exercise here can be
      &ldquo;completed&rdquo; by changing a config file and assuming it worked. Several of the traps in this book exist
      precisely to catch that &mdash; a command that exits 0 while the broker silently drops the message, a TLS call that
      does nothing because it ran a line too late, a rate limiter that looks broken because the test was sequential.
      Curiosity about <em>why</em> something passed is the skill this internship is really teaching.</p></div>
  </div>
</section>"""

RUN_SEC = f"""<section class="sec">
  <div class="sechead"><div class="rule"></div><p class="snum">02</p><h2>Running the sandbox</h2></div>
  <div class="stack">
    <p class="lede">No Docker, no containers. You install five ordinary programs, then start four of them
    in four terminals. Copy the commands exactly &mdash; there is nothing to figure out here.</p>

    <div class="stack">
      <h3>Step 1 &mdash; install the pieces <span style="color:{FAINT};font-weight:400">(once)</span></h3>
      <p>You need <strong>Python 3.10+</strong>, <strong>Node.js 18+</strong>, and three small background
      services: an MQTT broker, Redis and PostgreSQL.</p>
      <p style="font-size:9pt"><strong>Ubuntu, Debian or WSL</strong></p>
      <pre>sudo apt update
sudo apt install -y python3 python3-venv python3-pip \\
                    mosquitto mosquitto-clients redis-server postgresql

<span class="c"># Ubuntu starts mosquitto and Redis immediately, on 1883 and 6379 — the</span>
<span class="c"># ports the full cloud-robotics platform needs. Turn them off; you will</span>
<span class="c"># start your own, on different ports, below.</span>
sudo systemctl stop mosquitto redis-server
sudo systemctl disable mosquitto redis-server

<span class="c"># Postgres is worth leaving running, but move it off 5432 first.</span>
sudo sed -i 's/^port = 5432/port = 5433/' /etc/postgresql/*/main/postgresql.conf
sudo systemctl restart postgresql
pg_lsclusters                  <span class="c"># the port column should read 5433</span></pre>
      <p style="font-size:9pt"><strong>macOS</strong>, with Homebrew</p>
      <pre>brew install python node mosquitto redis postgresql@16

<span class="c"># Postgres on 5433, so it cannot collide with the main platform</span>
echo "port = 5433" &gt;&gt; $(brew --prefix)/var/postgresql@16/postgresql.conf
brew services start postgresql@16

<span class="c"># do NOT "brew services start" mosquitto or redis — you start those yourself</span></pre>
      <p><strong>Windows:</strong> install WSL2 and follow the Ubuntu steps inside it. Running these services
      natively on Windows is possible but fiddly, and nothing in these exercises needs it.</p>
    </div>

    <div class="stack">
      <h3>Step 2 &mdash; create the database <span style="color:{FAINT};font-weight:400">(once)</span></h3>
      <pre>sudo -u postgres psql -p 5433 -c "CREATE USER robotstore WITH PASSWORD 'robotstore';"
sudo -u postgres psql -p 5433 -c "CREATE DATABASE robotstore OWNER robotstore;"

<span class="c"># on macOS, drop the "sudo -u postgres" — Homebrew's Postgres runs as you:</span>
<span class="c">#   psql -p 5433 postgres -c "CREATE USER robotstore WITH PASSWORD 'robotstore';"</span></pre>
      <p>You never create the tables yourself. The backend does that the first time it starts.</p>
    </div>

    <div class="stack">
      <h3>Step 3 &mdash; install this project's dependencies <span style="color:{FAINT};font-weight:400">(once)</span></h3>
      <pre>cd secure_robotstore

<span class="c"># Python: one virtual environment shared by the backend and the agent</span>
python3 -m venv .venv
source .venv/bin/activate
pip install -r cloud/backend/requirements.txt -r robot-agent/requirements.txt

<span class="c"># JavaScript: the frontend</span>
cd cloud/frontend &amp;&amp; npm install &amp;&amp; cd ../..</pre>
      <p>A <em>virtual environment</em> is a private folder of Python packages belonging to this project alone,
      so installing something here cannot break anything else on your machine.
      <code>source .venv/bin/activate</code> is what switches a terminal into it &mdash; you will do that in two
      of the four terminals below, every time you open them.</p>
    </div>

    <div class="stack">
      <h3>Step 4 &mdash; start it, five terminals</h3>
      <p>Open five terminals, all in the <code>secure_robotstore</code> directory. Leave each running; each
      prints its own log, which is most of how you will debug things.</p>
      <div class="tw"><table>
        <tr><th style="width:74px">Terminal</th><th>Command</th></tr>
        <tr><td><strong>1</strong><br><span style="color:{FAINT}">broker</span></td>
            <td><code>mosquitto -c mosquitto/mosquitto.local.conf -v</code></td></tr>
        <tr><td><strong>2</strong><br><span style="color:{FAINT}">redis</span></td>
            <td><code>redis-server --port 6380</code></td></tr>
        <tr><td><strong>3</strong><br><span style="color:{FAINT}">backend</span></td>
            <td><code>source .venv/bin/activate</code><br><code>source local.env</code><br>
                <code>cd cloud/backend</code><br><code>uvicorn app.main:app --reload --port 8001</code></td></tr>
        <tr><td><strong>4</strong><br><span style="color:{FAINT}">agent</span></td>
            <td><code>source .venv/bin/activate</code><br><code>source local.env</code><br>
                <code>cd robot-agent</code><br><code>python -m agent.main</code></td></tr>
        <tr><td><strong>5</strong><br><span style="color:{FAINT}">frontend</span></td>
            <td><code>cd cloud/frontend</code><br>
                <code>VITE_API_URL=http://localhost:8001 npm run dev -- --port 3001</code></td></tr>
      </table></div>
      <p>Then open <strong>http://localhost:3001</strong> and sign in with <code>operator</code> /
      <code>demo1234</code>. Both windows should start filling at one row per second. Postgres is already
      running in the background as a system service, which is why it gets no terminal of its own.</p>
      <p><code>source local.env</code> does something small but essential: the backend and the agent default to
      the hostnames <code>mosquitto</code>, <code>postgres</code> and <code>redis</code>, which only exist inside
      a Docker network. That file points them at <code>localhost</code> instead.</p>
    </div>

    <div class="stack">
      <h3>Where everything is</h3>
      <div class="tw"><table>
        <tr><th>Service</th><th>Address</th><th>Notes</th></tr>
        <tr><td>Frontend</td><td><code>http://localhost:3001</code></td><td>login + Remote Data</td></tr>
        <tr><td>Backend API</td><td><code>http://localhost:8001</code></td><td><code>/docs</code> for the OpenAPI page</td></tr>
        <tr><td>Backend WS</td><td><code>ws://localhost:8001/ws/string_api</code></td><td>and <code>/ws/int_api</code></td></tr>
        <tr><td>Agent health</td><td><code>http://localhost:8081</code></td><td><code>{{"mqtt_connected": true}}</code></td></tr>
        <tr><td>MQTT broker</td><td><code>localhost:1884</code></td><td>anonymous, for now</td></tr>
        <tr><td>PostgreSQL</td><td><code>localhost:5433</code></td><td><code>robotstore</code> / <code>robotstore</code></td></tr>
        <tr><td>Redis</td><td><code>localhost:6380</code></td><td>no password</td></tr>
      </table></div>
      <p>Every one of those sits <strong>one above</strong> the full cloud-robotics platform's port
      (1883 / 6379 / 5432 / 8000 / 3000 / 8080), so the sandbox and the real platform can run on one machine
      at the same time. Nothing you install for this sandbox should ever listen on the platform's numbers &mdash;
      if the platform suddenly refuses to start, that is almost always what has happened.</p>
    </div>

    <div class="stack">
      <h3>If something does not work</h3>
      <div class="tw"><table>
        <tr><th style="width:34%">Symptom</th><th>What it means</th></tr>
        <tr><td><code>connection refused</code> on port 1884</td><td>Terminal 1 is not running.</td></tr>
        <tr><td>The <strong>main platform</strong> fails with <code>failed to bind host port 127.0.0.1:1883</code></td><td>Ubuntu's auto-started mosquitto or redis service is holding it. <code>sudo systemctl stop mosquitto redis-server</code>, then <code>disable</code> them. This sandbox never uses 1883 or 6379.</td></tr>
        <tr><td>Backend log repeats <code>lost the broker connection (rc=7)</code></td><td>Two MQTT clients are using the same client id and kicking each other off. You are running the stack twice &mdash; check for an old terminal.</td></tr>
        <tr><td><code>password authentication failed</code></td><td>Step 2 did not run, or ran against a different Postgres. Re-run it.</td></tr>
        <tr><td><code>Peer authentication failed</code></td><td>You connected over the local socket instead of TCP. Add <code>-h localhost</code> to the <code>psql</code> command.</td></tr>
        <tr><td><code>ModuleNotFoundError: fastapi</code></td><td>That terminal is not in the virtual environment. Run <code>source .venv/bin/activate</code> first.</td></tr>
        <tr><td>Both windows stay empty</td><td>Terminal 2 or 3 is not running. <code>curl localhost:8001/health/detail</code> names the broken dependency.</td></tr>
      </table></div>
    </div>

    <div class="note"><h4>Restarting after a change</h4>
      <p>There is no build step and no rebuild. Edit a Python file and the backend reloads itself
      (<code>--reload</code>); edit a React file and the browser updates. Only two things need a manual restart:
      the broker, after you edit <code>mosquitto/mosquitto.local.conf</code> &mdash; Ctrl-C in terminal 1 and run
      it again &mdash; and the agent, which has no reloader. That immediacy is the reason this runs without
      containers: the loop from &ldquo;edit a config&rdquo; to &ldquo;watch the attack fail&rdquo; is a few seconds.</p></div>
  </div>
</section>"""

ARCH_SEC = f"""<section class="sec">
  <div class="sechead"><div class="rule"></div><p class="snum">03</p><h2>Architecture overview</h2></div>
  <div class="stack">
    <p class="lede">One device publishes a string and an integer every second. Everything else in this system exists
    to move those two numbers safely to a browser &mdash; and it is the <em>safely</em> that is missing.</p>
    {fig_arch()}
    <div class="stack">
      <h3>The three design decisions worth understanding first</h3>
      <p><strong>MQTT is the only road in.</strong> Every byte between the device and the cloud crosses the broker
      &mdash; readings northbound, commands southbound. That is the single most valuable security property the
      architecture has, because it means there is exactly one place to enforce who may say what. Exercises 1, 2, 7 and 9
      are all spent on that one place.</p>
      <p><strong>Two stores, split by a single question.</strong> Postgres is the system of record &mdash; losing a row
      would be a bug. Redis holds what is live and re-derivable: the latest value (another is one second away) and a
      50&#8209;item ring buffer that populates a browser which has just connected. The test to apply to any new piece of
      data is <em>would losing this on restart be a bug?</em> Yes goes to Postgres; no goes to Redis.</p>
      <p><strong>One module owns the broker connection.</strong> <code>mqtt/service.py</code> is the only backend module
      that imports paho; everything else reaches the device through it. That is why the WebSocket layer never touches
      MQTT and the MQTT layer never touches Postgres &mdash; and it is why adding TLS and credentials later touches one
      file rather than five.</p>
      <p>One mechanic to know before changing any of it: paho runs its network loop on its own background thread, so its
      callbacks do <em>not</em> fire on the asyncio event loop. Anything a callback needs to do that touches async state
      is handed back across that boundary with <code>run_coroutine_threadsafe</code>. Calling an async handler directly
      from a paho callback is the classic bug here.</p>
    </div>
  </div>
</section>"""

CLOSING = f"""<section class="sec">
  <div class="sechead"><div class="rule"></div><p class="snum">04</p><h2>When you are done</h2></div>
  <div class="stack">
    <p class="lede">Re-run the three headline checks one final time.</p>
    <pre>make verify-holes</pre>
    <p>All three should now fail to demonstrate anything &mdash; the anonymous publish refused, the subscribe refused,
    the unauthenticated API read returning 401 &mdash; while the browser at <code>http://localhost:3001</code> still
    shows both windows ticking once a second.</p>
    <div class="note"><h4>That combination is the actual pass condition</h4>
      <p>Either half alone is easy. Anyone can lock a system down until it stops working, and anyone can keep a system
      working by changing nothing. Doing both at once, and being able to prove both at once, is the entire job.</p></div>
    <div class="stack">
      <h3>What is deliberately still missing</h3>
      <p>These are real limitations of the sandbox, and worth understanding before anyone builds on it. The <code>Hub</code>
      is in-process, so two backend replicas would each only push to their own WebSocket clients &mdash; the fix is Redis
      pub/sub between them. There are no tests; adding one for the reading path is a good first non-security task. There
      are no migrations, only <code>CREATE TABLE IF NOT EXISTS</code>. <code>--reload</code> and bind-mounted source are
      on for both Python services so your edits apply immediately &mdash; development settings, not production ones. And
      Postgres grows forever at about two rows per second; retention is not handled.</p>
      <p>None of those are security problems. Being able to tell the difference &mdash; and to say so plainly rather than
      filing everything as a vulnerability &mdash; is part of what makes a security engineer worth listening to.</p>
    </div>
    <div class="foot">
      <p><strong>The Twelve Exercises</strong> &mdash; secure_robotstore, a training mirror of the cloud-robotics
      teleoperation platform. Companion material: <code>secure_robotstore/README.md</code>,
      <code>docs/security-findings.md</code> (the audit these exercises draw their real findings from), and
      <code>docs/target-architecture.md</code>.</p>
    </div>
  </div>
</section>"""

html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>The Twelve Exercises</title>
<link rel="stylesheet" href="fonts.css">
<style>{CSS}</style>
</head><body>
{COVER}
{METHOD}
{PREREQ_SEC}
{RUN_SEC}
{ARCH_SEC}
{"".join(task_html(t) for t in TASKS)}
{CLOSING}
</body></html>"""

open("exercises.html", "w").write(html)
print("wrote exercises.html", len(html), "bytes ·", len(TASKS), "tasks ·", len(PREREQS), "prerequisites")
