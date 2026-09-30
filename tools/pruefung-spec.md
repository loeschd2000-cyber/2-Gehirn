# Spezifikation: Fragen für den Prüfungs-Trainer (Jarvis)

Zielgruppe: Azubi **Elektroniker/in für Automatisierungstechnik** (Industrie, IHK), Bayern.
Niveau: Berufsschule und IHK **Abschlussprüfung Teil 1** (AP1, ca. nach 18 Monaten) und **Teil 2** (AP2, Ende der Ausbildung).

## Datei
Eine JSON-Datei pro Thema: `web/assets/data/pruefung/<topic>.json`, UTF-8, gültiges JSON (mit `python3 -m json.tool` prüfen!).

```json
{
  "topic": "sps",
  "title": "SPS-Technik",
  "icon": "🧮",
  "part": "AP1+AP2",
  "questions": [
    { "id": "sps-001", "type": "mc", "level": 1, "part": "AP1",
      "q": "Frage …?",
      "options": ["Antwort A", "Antwort B", "Antwort C", "Antwort D"],
      "answer": 2,
      "explain": "Kurze Erklärung (1–3 Sätze), warum C richtig ist und ggf. warum ein typischer Fehler falsch ist.",
      "tags": ["Timer"] },
    { "id": "sps-021", "type": "calc", "level": 2, "part": "AP2",
      "q": "Rechenaufgabe mit allen nötigen Werten …?",
      "answer": "12,5 A", "value": 12.5, "unit": "A", "tolerance": 0.03,
      "explain": "Rechenweg Schritt für Schritt: Formel, Einsetzen, Ergebnis.",
      "tags": ["Leistung"] },
    { "id": "sps-027", "type": "open", "level": 2, "part": "AP2",
      "q": "Kurze Wissensfrage, die man mündlich in 1–2 Sätzen beantworten kann?",
      "answer": "Musterantwort in 1–2 Sätzen.",
      "keywords": ["Schlüsselwort1", "Schlüsselwort2"],
      "explain": "Ergänzende Erklärung.",
      "tags": ["Grundlagen"] }
  ]
}
```

## Regeln
- **Genau 30 Fragen pro Thema**, IDs fortlaufend `<topic>-001` … `<topic>-030`.
- Mischung: ca. **21 `mc`** (Multiple Choice), **5 `calc`** (Rechnen), **4 `open`** (kurze freie Antwort, gut für Sprachabfrage). Bei Themen ohne sinnvolles Rechnen (z. B. WiSo, IT-Sicherheit): statt `calc` mehr `mc`/`open`.
- `mc`: genau **4 Optionen**, **genau eine** richtig; `answer` = Index 0–3. Richtige Position gleichmäßig verteilen (ungefähr gleich oft 0, 1, 2, 3). Falsche Antworten plausibel (typische Irrtümer), nicht albern. Keine „alle genannten“/„keine der genannten“.
- `calc`: alle Werte in der Frage; `value` = Zahl (Punkt als Dezimaltrenner in JSON), `unit` = Einheit, `tolerance` = relative Toleranz (0.02–0.05), `answer` = Text mit Komma und Einheit. Im `explain` den Rechenweg. Ergebnis selbst nachrechnen!
- `open`: Musterantwort kurz; `keywords` = 2–4 Wörter, die in einer richtigen Antwort vorkommen sollten (Kleinschreibung egal, einfache Wortstämme).
- `level`: 1 = leicht (Grundwissen), 2 = mittel (typisch Prüfung), 3 = schwer.
- `part`: "AP1", "AP2" oder "AP1+AP2".
- Sprache: Deutsch, klar, Fachbegriffe korrekt, Du-Form ist nicht nötig (neutral). Normen korrekt benennen (z. B. DIN VDE 0100-410, DIN VDE 0105-100, DIN EN 60204-1, DIN EN ISO 13849-1, IEC 61131-3). Keine Jahresversionen/Details erfinden, bei Unsicherheit weglassen.
- **Fachlich 100 % korrekt** – im Zweifel die Frage weglassen und eine andere schreiben. Keine Fangfragen mit mehrdeutiger Lösung.
- **Eigene Formulierungen**, keine wörtlich kopierten Original-IHK-Aufgaben.
- Werte realistisch (230/400 V, 50 Hz, typische Motorleistungen usw.). Dezimalkomma im Fragetext.
- Das Tag-Feld: 1–2 kurze Unterthemen.
