"""Packt alle Prüfungsfragen (web/assets/data/pruefung/*.json) in EINE Datei assets/data/pruefung.js,
die der Prüfungs-Trainer bei Bedarf nachlädt (klappt auch ohne Server, z. B. file://)."""
import json, glob, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORDER = ["et-grundlagen", "wechselstrom", "schutz", "pruefen", "elektronik", "digital", "sps", "regelung",
         "antriebe", "sensorik", "pneumatik", "netzwerk", "maschinensicherheit", "it", "planung", "wiso"]
topics = {}
for f in glob.glob(os.path.join(ROOT, "web/assets/data/pruefung/*.json")):
    d = json.load(open(f, encoding="utf-8"))
    for q in d["questions"]:
        assert q["type"] in ("mc", "calc", "open"), q["id"]
        if q["type"] == "mc": assert len(q["options"]) == 4 and 0 <= q["answer"] <= 3, q["id"]
        if q["type"] == "calc": assert isinstance(q["value"], (int, float)), q["id"]
    topics[d["topic"]] = d
out = [topics[t] for t in ORDER if t in topics] + [v for k, v in topics.items() if k not in ORDER]
js = "window.PRUEFUNG = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n"
os.makedirs(os.path.join(ROOT, "web/assets/data"), exist_ok=True)
open(os.path.join(ROOT, "web/assets/data/pruefung.js"), "w", encoding="utf-8").write(js)
print(f"pruefung.js: {len(out)} Themen, {sum(len(t['questions']) for t in out)} Fragen, {len(js)//1024} KB")
