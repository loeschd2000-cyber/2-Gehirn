# Einmalig: die große HTML-Datei in index.html + assets/app.css + assets/js/*.js aufteilen
import re, os, sys
src = open(sys.argv[1], encoding="utf-8").read()
root = sys.argv[2]
lines = src.split("\n")
def find(pat, start=0):
    for i in range(start, len(lines)):
        if pat in lines[i]: return i
    raise SystemExit("nicht gefunden: " + pat)
s0 = find("<style>"); s1 = find("</style>")
j0 = find("<script>"); j1 = find("</script>", j0)
css = "\n".join(lines[s0+1:s1])
head = lines[:s0]; body = lines[s1+1:j0]; tail = lines[j1+1:]
js = lines[j0+1:j1]
# Schnittpunkte (Zeilenanfang-Marker) -> Dateiname
cuts = [
  ("/* ================= Grundlagen", "01-core.js"),
  ("/* ================= KI-Motor", "02-ai.js"),
  ("/* ================= Google (Kalender", "03-google.js"),
  ("/* ---------- Was will der Nutzer?", "04-intents.js"),
  ("/* ---------- Tagebuch:", "05-diary.js"),
  ("/* ---------- Finanzen (Bankkonto", "06-finance.js"),
  ("/* ---------- Phantom Wallet", "07-wallet.js"),
  ("/* ---------- WhatsApp", "08-messages-music.js"),
  ("/* ---------- Wecker (nur Android", "09-alarm.js"),
  ("  /* =====================================================================", "10-extras.js"),
  ("  async function handleActions(text) {", "11-actions.js"),
  ("/* ---------- Kalender ---------- */", "12-calendar-mail.js"),
  ("/* ================= Neue Bedienelemente", "13-ui.js"),
  ("/* ================= Kern-Animation", "14-orb.js"),
  ("/* ================= Start ================= */", "99-start.js"),
]
idx = []
pos = 0
for marker, name in cuts:
    for i in range(pos, len(js)):
        if marker in js[i]:
            idx.append((i, name)); pos = i + 1; break
    else: raise SystemExit("Marker fehlt: " + marker)
os.makedirs(os.path.join(root, "assets", "js"), exist_ok=True)
open(os.path.join(root, "assets", "app.css"), "w", encoding="utf-8").write(css.strip("\n") + "\n")
names = []
for k, (i, name) in enumerate(idx):
    end = idx[k+1][0] if k + 1 < len(idx) else len(js)
    start = 0 if k == 0 else i
    chunk = "\n".join(js[start:end]).strip("\n") + "\n"
    open(os.path.join(root, "assets", "js", name), "w", encoding="utf-8").write("\"use strict\";\n" if False else chunk)
    names.append(name)
html = "\n".join(head) + '\n<link rel="stylesheet" href="assets/app.css?v=__V__">\n' + "\n".join(body) + "\n" + \
       "\n".join(f'<script src="assets/js/{n}?v=__V__"></script>' for n in names) + "\n" + "\n".join(tail)
open(os.path.join(root, "index.src.html"), "w", encoding="utf-8").write(html)
print("ok", names)
