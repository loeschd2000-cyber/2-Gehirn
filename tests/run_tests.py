"""
Automatische Tests für Jarvis (Zweites Gehirn).
Startet die Web-App in einem unsichtbaren Browser, spielt eine „Android-App“ und alle Internet-Dienste
(Wetter, Gemini, Kurse, Bank …) nach und prüft, ob Jarvis auf viele Sätze richtig reagiert.

Aufruf:  python tests/run_tests.py          (aus dem Repo-Ordner, vorher tools/build.sh)
Ergebnis: Liste mit ✓ / ✗ und am Ende Exit-Code 0 (alles gut) oder 1 (Fehler).
"""
import asyncio, json, os, sys, datetime, re
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = "file://" + os.path.join(ROOT, "index.html")
H = {"access-control-allow-origin": "*", "access-control-allow-headers": "*"}

today = datetime.date.today()
def mday(back, day):
    y, m = today.year, today.month - back
    while m <= 0: m += 12; y -= 1
    return f"{y}-{m:02d}-{min(day, 28):02d}"
TX = []
for mb in range(6):
    TX += [
        {"date": mday(mb, 1), "amount": 1050.0, "name": "Muster GmbH", "text": "Ausbildungsverguetung"},
        {"date": mday(mb, 3), "amount": -420.0, "name": "Vermieter Schmidt", "text": "Miete"},
        {"date": mday(mb, 5), "amount": -9.99, "name": "Spotify AB", "text": "Spotify Premium"},
        {"date": mday(mb, 6), "amount": -24.99, "name": "Telekom Deutschland", "text": "Mobilfunk"},
        {"date": mday(mb, 8), "amount": -38.5, "name": "REWE Markt", "text": "REWE SAGT DANKE"},
        {"date": mday(mb, 15), "amount": -17.8, "name": "McDonalds", "text": ""},
    ]
TX = [t for t in TX if t["date"] <= today.isoformat()]
BANK = {"ok": True, "balance": 812.45, "currency": "EUR", "fetched": int(datetime.datetime.now().timestamp() * 1000), "transactions": TX}

FAKE_ANDROID = """
window.__and = [];
const L = x => window.__and.push(x);
window.ZGAndroid = {
  version: () => '9.9', isMini: () => false, wakeOn: () => false, wakeSet: () => {}, consumeWake: () => false, consumeDiary: () => false,
  srStart: () => 1, srStop: () => {}, srAbort: () => {},
  ttsSpeak: (id) => { setTimeout(() => { window.__zgTTS && __zgTTS.emit({type:'start', id}); setTimeout(() => __zgTTS.emit({type:'end', id}), 5); }, 5); },
  ttsCancel: () => {}, ttsVoices: () => '[]',
  googleTokenSilent: () => setTimeout(() => window.__zgGoogle.emit({ token: 'tok' }), 5), googleToken: () => setTimeout(() => window.__zgGoogle.emit({ token: 'tok' }), 5),
  phoneReady: () => true, requestPhone: () => {},
  findContacts: q => JSON.stringify(/papa/i.test(q) ? [{ name: 'Papa', number: '0171 1234567', mobile: true, primary: true }] : []),
  call: n => L('call ' + n), media: c => L('media ' + c), spotifyPlaylist: n => { L('playlist ' + n); return true; }, spotifyPlay: (q, a) => { L('spotify ' + q + (a && a !== q ? ' / ' + a : '')); return true; },
  whatsappReady: () => true, whatsappAuto: () => true, whatsappSend: (n, t) => { L('whatsapp ' + n + ' ' + t); return true; },
  alexaReady: () => true, alexaAlarm: (a) => { L('alexa ' + new Date(+a).getHours() + ':' + new Date(+a).getMinutes()); return 1; },
  alexaAlarms: () => '[]', alexaCancel: () => L('alexaCancel'), phoneAlarm: (h, m) => L('phone ' + h + ':' + m),
  bankState: () => JSON.stringify({ connected: true, bank: 'Sparkasse' }), bankCached: () => JSON.stringify(%BANK%), bankFetch: () => {},
  reminderAdd: (a, t) => { L('reminder ' + t); return 1; }, reminderList: () => '[]', reminderCancel: () => {},
  timer: (s, l) => L('timer ' + s), maps: (d, m, s) => L('maps ' + d + ' ' + s),
  priceAlertAdd: (c, s, b, p) => { L('price ' + c + ' ' + b + ' ' + p); return 1; }, priceAlertList: () => '[]', priceAlertCancel: () => {},
  diaryReminder: (h, m) => L('diaryReminder ' + h + ':' + m), musicAccess: () => true,
  amazonInstalled: () => true, amazonCart: (a, q) => { L('amazonCart ' + a + ' ' + q); setTimeout(() => __zgShop.emit({ type: 'cart', ok: true, msg: 'im Warenkorb' }), 20); },
  amazonFind: (q, id) => { L('amazonFind ' + q); const it = /airpods/i.test(q) ? [{ asin: 'B0D1XD1ZV3', title: 'Apple AirPods Pro 2 (2. Generation) mit USB-C', price: 229 }]
      : /zahnpasta/i.test(q) ? [{ asin: 'B0AAAAAAAA', title: 'Zahnbürsten-Halterung für Bad', price: 9.99 }, { asin: 'B08N5WRWNW', title: 'Oral-B Pro-Expert Zahnpasta, 75 ml', price: 3.99 }]
      : [{ asin: 'B07XYZ1234', title: 'Varta Batterien AA, 20 Stück', price: 8.49 }];
    setTimeout(() => __zgShop.emit({ type: 'find', id, ok: true, items: it }), 20); },
  amazonSearch: q => L('amazonSearch ' + q), copyText: t => L('copy ' + t.slice(0, 30)), openLink: (u, p) => L('open ' + u),
  http: (id, m, u, h, b) => fetch(u, { method: m, headers: JSON.parse(h || '{}'), body: m === 'GET' ? undefined : b }).then(async r => __zgNet.emit({ id, status: r.status, body: await r.text() })).catch(e => __zgNet.emit({ id, status: 0, error: String(e) })),
  untisReady: () => true,
  untisRange: (id, from, to) => { const ls = []; for (let d = from; d <= to; d++) { if (d % 100 > 31) continue;
      ls.push({ date: d, startTime: 745, endTime: 915, su: [{ name: 'SPS', longname: 'SPS' }], ro: [{ name: 'B12' }] });
      ls.push({ date: d, startTime: 930, endTime: 1100, su: [{ name: 'D', longname: 'Deutsch' }], code: 'cancelled' });
      ls.push({ date: d, startTime: 1115, endTime: 1245, su: [{ name: 'ET', longname: 'Elektrotechnik' }] }); }
    setTimeout(() => __zgNet.emit({ id, ok: true, lessons: ls }), 10); },
  untisSearch: (id, q) => setTimeout(() => __zgNet.emit({ id, ok: true, schools: [] }), 10),
  locNow: id => setTimeout(() => __zgNet.emit({ id, ok: true, lat: 50.05, lng: 10.23 }), 10), locState: () => 'bg', locPerm: b => L('locPerm ' + b),
  placeAdd: (t, p, s, r) => { L('place ' + t + ' @' + p + ' ' + JSON.parse(s).length); return 'ok'; }, placeList: () => '[]', placeRemove: id => L('placeRemove ' + id),
  torch: on => { L('torch ' + on); return 'ok'; }, dnd: on => { L('dnd ' + on); return 'ok'; }, ringer: m => { L('ringer ' + m); return 'ok'; },
  battery: () => JSON.stringify({ pct: 76, charging: false, fullInMin: -1 }),
  healthState: () => 'ok', healthConnect: () => L('healthConnect'),
  healthToday: id => setTimeout(() => __zgNet.emit({ id, ok: true, steps: 8234, sleepMin: 445, sleepStart: Date.now() - 9 * 3600e3, sleepEnd: Date.now() - 1.5 * 3600e3 }), 10),
  fuelWatchSet: (l, t, a, g) => L('fuelwatch ' + l + ' ' + t), fuelWatchGet: () => '', fuelWatchClear: () => L('fuelwatchClear'),
  priceWatchAdd: (a, n, l, now) => { L('pricewatch ' + a + ' ' + l); return 1; }, priceWatchList: () => '[]', priceWatchCancel: () => {}, priceWatchModel: () => {},
};
localStorage.setItem('zg_gemini_key', 'AIzaTESTKEY1234567890abcdef'); localStorage.setItem('zg_tk_key', '12345678-1234-1234-1234-123456789abc'); localStorage.setItem('zg_dhl_key', 'DHLTESTKEY1234567890'); localStorage.setItem('zg_ai_mode', 'gemini');
localStorage.setItem('zg_wallet', JSON.stringify({ addr: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', invested: 400 }));
""".replace("%BANK%", json.dumps(BANK))

def llm_answer(body):
    """Antworten der nachgebauten Gemini-KI (je nach Aufgabe)."""
    if "Stelle EINE neue" in body: return {"frage": "Wofür steht SPS?", "antwort": "Speicherprogrammierbare Steuerung"}
    if "Bewerte fair" in body: return {"richtig": True, "erklaerung": "Genau."}
    if "Tagebuch erzählt" in body: return {"titel": "Guter Tag", "text": "Heute war ein guter Tag.", "stimmung": "😊 gut"}
    if "WhatsApp schreiben" in body: return {"nachricht": "Ich komme später."}
    if "Kleinanzeigen" in body: return "__TEXT__" + json.dumps({"titel": "Xbox Controller schwarz", "preis": 25, "preis_spanne": "20–30 €", "beschreibung": "Verkaufe meinen Xbox Controller. [Zustand ergänzen]. Privatverkauf, keine Garantie.", "tipp": "Gute Fotos machen."})
    if "Berichtsheft (Ausbildungsnachweis" in body: return {"betrieb": "Montag: Schaltschrank verdrahtet und geprüft", "schule": "", "unterweisungen": ""}
    if "Lernplan: pro Tag" in body: return {"tage": [{"thema": "SPS Grundlagen", "uebung": "Aufbau einer SPS skizzieren"}, {"thema": "Logikfunktionen", "uebung": "UND/ODER üben"}]}
    if "ehrlicher Spar-Coach" in body: return {"tipps": [{"titel": "Spotify auf Studententarif", "euro_pro_monat": 5, "wie": "Tarif wechseln"}, {"titel": "Weniger Fast Food", "euro_pro_monat": 10, "wie": "zweimal weniger im Monat"}]}
    if "freundliche Bewerbung" in body: return {"betreff": "Anfrage zu Ihrem Auftrag", "text": "Hallo, ich bin Damian und habe Interesse. [Beispiele ergänzen]"}
    if "wortwörtlich" in body: return "__TEXT__Was steht auf der Einkaufsliste?"
    if "Fundstellen aus seinen alten" in body: return {"antwort": "Du hast gesagt, dass Lukas am 12. März Geburtstag hat."}
    if "Befehls-Übersetzer" in body:
        if "Käse" in body: return {"befehle": ["Setz Käse und Brot auf die Einkaufsliste", "Was steht auf der Einkaufsliste?"]}
        if "klingeln" in body: return {"befehle": ["Stell den Wecker um 7 Uhr"]}
        return {"befehle": []}
    if '"aktion"' in body or "aktion" in body[:3000]: return {"aktion": "keine"}
    return None

TTS_HITS = []
GS_HITS = []
PC_HITS = []
async def route(r):
    u = r.request.url
    if u.endswith("/pc/do"):
        PC_HITS.append(r.request.post_data); return await r.fulfill(json={"ok": True, "msg": ""}, headers=H)
    if u.startswith("file:"): return await r.continue_()
    if r.request.method == "OPTIONS": return await r.fulfill(status=204, headers=H)
    if "geocoding-api" in u: return await r.fulfill(json={"results": [{"latitude": 50.03, "longitude": 10.51, "name": "Haßfurt"}]}, headers=H)
    if "api.open-meteo" in u: return await r.fulfill(json={"current": {"temperature_2m": 11.4}, "daily": {"weather_code": [61, 3, 0], "temperature_2m_max": [13, 16, 19], "temperature_2m_min": [7, 8, 9], "precipitation_probability_max": [70, 20, 5]}}, headers=H)
    if "coingecko" in u: return await r.fulfill(json={"solana": {"usd": 118.2, "eur": 101.5}}, headers=H)
    if "price/v3" in u: return await r.fulfill(json={"So11111111111111111111111111111111111111112": {"usdPrice": 150, "priceChange24h": 2}}, headers=H)
    if "tokens/v2" in u: return await r.fulfill(json=[], headers=H)
    if "frankfurter" in u: return await r.fulfill(json={"rates": {"EUR": 0.9}}, headers=H)
    if "publicnode" in u or "mainnet-beta" in u:
        b = json.loads(r.request.post_data)
        if b["method"] == "getBalance": return await r.fulfill(json={"result": {"value": 3200000000}}, headers=H)
        return await r.fulfill(json={"result": {"value": []}}, headers=H)
    if "tankerkoenig" in u: return await r.fulfill(json={"ok": True, "stations": [
        {"id": "a", "name": "Aral Schweinfurt", "brand": "Aral", "street": "Hauptstraße", "houseNumber": "1", "place": "Schweinfurt", "lat": 50.04, "lng": 10.22, "dist": 2.3, "price": 1.579, "isOpen": True},
        {"id": "b", "name": "Shell", "brand": "Shell", "street": "Ring", "houseNumber": "5", "place": "Gochsheim", "lat": 50.02, "lng": 10.28, "dist": 4.1, "price": 1.629, "isOpen": True}]}, headers=H)
    if "tagesschau.de" in u: return await r.fulfill(json={"news": [{"title": "Schlagzeile Eins", "topline": "Politik", "firstSentence": "Erster Satz.", "shareURL": "https://www.tagesschau.de/1", "type": "story"},
        {"title": "Schlagzeile Zwei", "topline": "Wirtschaft", "shareURL": "https://www.tagesschau.de/2", "type": "story"}, {"title": "Schlagzeile Drei", "shareURL": "https://www.tagesschau.de/3", "type": "story"}]}, headers=H)
    if "overpass-api" in u: return await r.fulfill(json={"elements": [{"type": "node", "lat": 50.051, "lon": 10.231, "tags": {"name": "EDEKA Müller"}}, {"type": "way", "center": {"lat": 50.07, "lon": 10.25}, "tags": {"brand": "EDEKA"}}]}, headers=H)
    if "api-eu.dhl.com" in u: return await r.fulfill(json={"shipments": [{"id": "00340434161234567890", "status": {"statusCode": "transit", "description": "Die Sendung wurde im Zustell-Depot bearbeitet."}, "estimatedTimeOfDelivery": (today + datetime.timedelta(days=1)).isoformat() + "T12:00:00Z"}]}, headers=H)
    if "calendar/v3" in u: return await r.fulfill(json={"id": "ev1", "items": []}, headers=H)
    if "gmail.googleapis" in u: return await r.fulfill(json={"messages": []}, headers=H)
    if "generativelanguage" in u:
        if "/models?" in u: return await r.fulfill(json={"models": [{"name": "models/gemini-3.8-flash", "supportedGenerationMethods": ["generateContent"]}]}, headers=H)
        body = r.request.post_data or ""
        if '"AUDIO"' in body:
            TTS_HITS.append(body)
            import base64
            pcm = base64.b64encode(b"\x00\x00" * 2400).decode()
            return await r.fulfill(json={"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "audio/L16;codec=pcm;rate=24000", "data": pcm}}]}}]}, headers=H)
        if '"google_search"' in body:   # wie beim kostenlosen Schlüssel: Google-Suche gesperrt
            GS_HITS.append(1)
            return await r.fulfill(status=429, json={"error": {"code": 429, "message": "Quota exceeded for metric: generate_content_free_tier_requests google_search, limit: 0"}}, headers=H)
        out = llm_answer(body)
        if "streamGenerateContent" in u:
            text = "Das ist eine Testantwort."
            return await r.fulfill(status=200, body='data: {"candidates":[{"content":{"parts":[{"text":"' + text + '"}]}}]}\n\n', headers={**H, "content-type": "text/event-stream"})
        if isinstance(out, str) and out.startswith("__TEXT__"): return await r.fulfill(json={"candidates": [{"content": {"parts": [{"text": out[8:]}]}}]}, headers=H)
        return await r.fulfill(json={"candidates": [{"content": {"parts": [{"text": json.dumps(out or {"aktion": "keine"})}]}}]}, headers=H)
    return await r.abort()

# (Satz, erwartete Teile in Antwort ODER Android-Aufrufen)
CASES = [
    ("Merk dir, ich wohne in Haßfurt", ["wohnst in Haßfurt"]),
    ("Wie wird das Wetter morgen?", ["Morgen in Haßfurt", "bewölkt"]),
    ("Brauch ich heute eine Jacke?", ["Jacke mitnehmen"]),
    ("Setz Milch und Eier auf die Einkaufsliste", ["Milch und Eier"]),
    ("Was steht auf der Einkaufsliste?", ["Milch, Eier"]),
    ("Streich Milch von der Einkaufsliste", ["Abgehakt"]),
    ("Erinner mich morgen um 16 Uhr an die Hausaufgaben", ["reminder Die Hausaufgaben"]),
    ("Stell einen Timer auf 12 Minuten", ["timer 720"]),
    ("Merk dir, Lukas hat am 12. März Geburtstag", ["12. März"]),
    ("Merk dir, meine Berufsschule ist in Schweinfurt", ["Berufsschule ist Schweinfurt"]),
    ("Navigier mich zur Berufsschule", ["maps Schweinfurt true"]),
    ("Stundenplan Montag: SPS, Elektrotechnik, Deutsch", ["Montag hast du SPS"]),
    ("Am 15. Oktober schreiben wir eine Arbeit in SPS", ["Arbeit in SPS"]),
    ("Setz mein Monatsbudget auf 600 Euro", ["600 Euro"]),
    ("Sag mir Bescheid, wenn SOL unter 100 Dollar fällt", ["price solana true 100"]),
    ("Stell den Wecker um 6 Uhr", ["alexa 6:0", "phone 6:0"]),
    ("Spiel Gzuz", ["spotify gzuz"]),
    ("Stopp", ["media pause"]),
    ("Musik stoppen", ["media pause"]),
    ("Hör auf mit der Musik", ["media pause"]),
    ("Spiel weiter", ["media play"]),
    ("Weiterspielen", ["media play"]),
    ("Lauter", ["media louder"]),
    ("Mach lauter", ["media louder"]),
    ("Leiser bitte", ["media quieter"]),
    ("Mach die Musik leiser", ["media quieter"]),
    ("Nächster Song", ["media next"]),
    ("Nächstes", ["media next"]),
    ("Vorheriger Song", ["media previous"]),
    ("Das Lied davor", ["media previous"]),
    ("Pause", ["media pause"]),
    ("Musik aus", ["media pause"]),
    ("Skip", ["media next"]),
    ("Spiele die Playlist Lieblingssongs auf Spotify", ["playlist lieblingssongs"]),
    ("Spiel meine Chill Playlist", ["playlist chill"]),
    ("Spiel meine Lieblingssongs", ["playlist lieblingssongs"]),
    ("Spiel die Playlist Gym von Anfang an", ["playlist gym"]),
    ("Spiel Blinding Lights von The Weeknd", ["spotify blinding lights / the weeknd"]),
    ("Spiel Musik von Apache 207", ["spotify apache 207"], ["/ apache"]),
    ("spiel die Musik weiter", ["media play"]),
    ("nächstes Lied", ["media next"]),
    ("Ruf Papa an", ["Ich rufe Papa an"]),
    ("Schreib Papa auf WhatsApp hallo", ["Soll ich das senden"]),
    ("ja", ["whatsapp 0171 1234567 Hallo"]),
    ("Wie sieht's aus mit meinen Finanzen?", ["Kontostand ist 812"]),
    ("Was sind meine Fixkosten?", ["Vermieter Schmidt"]),
    ("Zeig mir eine Statistik von meinem Konto", ["Hier ist deine Statistik"]),
    ("Wie sieht's aus in meiner Phantom Wallet?", ["Phantom Wallet ist gerade"]),
    ("Tagebuch", ["Tagebuch für"]),
    ("Heute war Berufsschule.", []),
    ("fertig", ["Gespeichert"]),
    ("Lies mir mein Tagebuch von heute vor", ["Dein Tagebuch von heute"]),
    ("Was weißt du über mich?", ["Dinge gemerkt"]),
    ("Was hab ich über Lukas gesagt?", ["Fundstelle", "12. März Geburtstag"]),
    ("Such in meinem Tagebuch nach Berufsschule", ["Tagebuch"]),
    ("Was hab ich über Quantenphysik gesagt?", ["nichts gefunden"]),
    # --- Fehler, die bei der Durchsicht gefunden wurden (dürfen nie wieder auftreten) ---
    ("Schreib Papa auf WhatsApp hallo", ["Soll ich das senden"]),
    ("bitte nicht", ["nicht gesendet"], ["whatsapp 0171"]),
    ("Wie sieht mein Budget aus?", ["600 Euro"], ["gelöscht"]),
    ("Hab ich morgen einen Test?", [], ["Eingetragen"]),
    ("Kontostand abfragen", [], ["Lernmodus"]),
    ("Hör auf", [], ["spotify"]),
    ("Leg los", [], ["spotify"]),
    ("Termin morgen um 10: Zahnarzt anrufen", [], ["in deinen Kontakten", "Ich rufe"]),
    ("Vergiss PS", ["nichts gespeichert"], []),
    ("Erinner mich morgen Abend um 8 an den Müll", ["20 Uhr"], []),
    ("Schreib Papa eine Nachricht per Mail, dass ich später komme", [], ["Soll ich das senden"]),
    # --- freie Sätze über den KI-Helfer (auch mehrere Befehle auf einmal) ---
    ("Kannst du bitte Käse und Brot bei den Einkäufen notieren und mir danach sagen was alles drauf ist", ["Käse und Brot", "Käse, Brot"]),
    ("Lass es morgen früh um 7 klingeln", ["alexa 7:0"]),
    ("Was kannst du?", ["alle Befehle"]),
    # --- Anrede „Boss“, Amazon, Geld ---
    ("Guten Morgen", ["Boss"]),
    ("Nenn mich Chef", ["Alles klar, Chef"]),
    ("Nenn mich Boss", ["Alles klar, Boss"]),
    ("Bestell Zahnpasta auf Amazon", ["Oral-B", "Warenkorb"]),
    ("ja", ["amazonCart B08N5WRWNW 1", "Liegt im Warenkorb"]),
    ("Kannst du mir bitte Zahnpasta auf Amazon bestellen?", ["Oral-B", "Warenkorb"]),
    ("nein", ["nicht in den Warenkorb"]),
    ("Leg zwei Packungen Batterien in den Warenkorb", ["Warenkorb", "2 Stück"]),
    ("nein", ["nicht in den Warenkorb"], ["amazonCart"]),
    ("Sag mir Bescheid, wenn die AirPods Pro unter 180 Euro fallen", ["pricewatch B0D1XD1ZV3 180"]),
    ("Verkauf meinen alten Xbox Controller", ["Kleinanzeige", "25 € VB"]),
    ("ja", ["copy Xbox Controller", "open https://www.kleinanzeigen.de"]),
    ("Wo kann ich sparen?", ["Spar-Coach", "15"]),
    ("Such mir Programmier-Jobs", ["Job-Finder", "Arduino", "Suche öffnen"], ["nicht geklappt", "Limit"]),
    ("Finde einen Job", ["Minijobs in deiner Nähe", "Arbeitsagentur"], ["nicht geklappt"]),
    ("Schreib mir eine Bewerbung für Job 1", ["Anzeige"]),
    # --- Weitere Dienste ---
    ("Fällt morgen was aus?", ["Deutsch", "fällt aus"]),
    ("Wann hab ich morgen Schluss?", ["12:45 Uhr Schluss"]),
    ("Stundenplan diese Woche", ["Stundenplan (Untis)", "SPS"]),
    ("js:(() => { const t = new Date(Date.now() + 864e5), u = new Date(Date.now() + 3 * 864e5), f = d => d.toISOString().slice(0, 10); dataSet('muell', { oid: 'x', ort: 'Gochsheim', strasse: 'Hauptstraße', items: [{ d: f(t), t: 'Gelber Sack' }, { d: f(u), t: 'Restmüll' }], fetched: Date.now() }); })()", []),
    ("Welcher Müll kommt morgen?", ["Gelber Sack"]),
    ("Wann kommt die Restmülltonne?", ["Restmüll wird"]),
    ("Wann ist die nächste Abfuhr?", ["Gelber Sack", "Müllabfuhr"]),
    ("Wo ist Diesel am billigsten?", ["Aral", "1,579"]),
    ("Sag mir Bescheid, wenn Diesel unter 1,60 kostet", ["fuelwatch 1.6 diesel"]),
    ("Was gibt es Neues in der Welt?", ["Tagesschau", "Schlagzeile Eins"]),
    ("Taschenlampe an", ["torch true"]),
    ("Taschenlampe aus", ["torch false"]),
    ("Nicht stören an", ["dnd true"]),
    ("Mach das Handy lautlos", ["ringer silent"]),
    ("Handy wieder laut", ["ringer normal"]),
    ("Wie voll ist mein Akku?", ["76 Prozent"]),
    ("Wie hab ich geschlafen?", ["7 Stunden 25 Minuten"]),
    ("Wie viele Schritte hab ich heute?", ["8.234"]),
    ("Berichtsheft: heute habe ich einen Schaltschrank verdrahtet", ["Notiert"]),
    ("Mach meinen Wochenbericht", ["KW", "Schaltschrank"]),
    ("Mach mir einen Lernplan für SPS", ["Lernplan", "SPS Grundlagen"]),
    ("Erinner mich beim Edeka an Milch", ["place Milch @Edeka 2"]),
    ("Merk dir, hier ist mein Zuhause", ["dein Zuhause"]),
    ("Erinner mich zu Hause an den Müll", ["place Den Müll @Zuhause 1"]),
    ("Verfolge Sendung 00340434161234567890", ["unterwegs", "Zustell-Depot"]),
    ("Schalte den Fernseher aus", ["SmartThings ist noch nicht verbunden"]),
    ("Guten Morgen", ["Schlagzeile", "SPS"]),
    # dürfen NICHT von den neuen Diensten abgefangen werden
    ("Was ist ein Spannungsabfall?", [], ["abgeholt", "Müllabfuhr"]),
    ("Was tun bei Stromausfall?", [], ["Untis"]),
    ("Warum ist Schule wichtig?", [], ["Untis"]),
    ("Setz Tanken auf die To-do-Liste", ["To-do-Liste"], ["Aral"]),
    ("Bestell eine Taschenlampe auf Amazon", [], ["torch"]),
    ("nein", []),
    ("Schreib Papa auf WhatsApp, er soll mich nicht stören", [], ["dnd"]),
    ("nein", []),
    ("Leg noch eine Lampe in den Warenkorb", [], ["SmartThings"]),
    ("nein", []),
    ("Hier ist es echt kalt", [], ["Gemerkt: Hier"]),
    ("Erinner mich bei Rewe an Brot", ["place Brot @Rewe"]),
    ("Berichtsheft schreiben", ["Was hast du heute gemacht"]),
    ("Heute Schütze verdrahtet und einen Motor angeschlossen", ["Notiert"]),
    ("Wo ist Super am billigsten?", ["Super E5"]),
    ("js:pcCtl = true; PC_BASE = 'http://pc.test'", []),
    ("Mach am PC leiser", ["PC: Leiser"]),
    ("Öffne Spotify am PC", ["Ich öffne Spotify am PC"]),
    ("Fahr den PC in 30 Minuten herunter", ["in 30 Minuten herunterfahren"]),
    ("nein", ["mache ich nicht"]),
    ("Mach leiser", [], ["PC:"]),
    ("Mach die Lautstärke am PC runter", [], ["herunterfahren"]),
    ("Herunterfahren abbrechen", ["bleibt an"]),
    ("Wann ist Sperrmüll?", [], ["gesperrt"]),
    ("Sperr den PC", ["gesperrt"]),
    ("Stell am PC die Lautstärke auf 30", ["30 Prozent"]),
    ("Ich finde Nachrichten über Politik langweilig", [], ["nichts gefunden"]),
    ("Leg mal Apache 207 auf", ["spotify apache 207"]),
    ("Schreib Papa auf WhatsApp hallo", ["Soll ich das senden"]),
    ("Ja, schick es, ich komme nicht", ["whatsapp 0171"], ["nicht gesendet"]),
    ("Frag mich SPS ab", ["Lernmodus: SPS"]),
    ("Stopp", ["Lernmodus beendet"]),
]

async def main():
    ok = fail = 0
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1300, "height": 900})
        await pg.route("**/*", route)
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.add_init_script(FAKE_ANDROID)
        await pg.goto(PAGE)
        await pg.wait_for_function("typeof busy !== 'undefined' && document.getElementById('boot')", timeout=10000)
        await pg.wait_for_timeout(1500)
        for case in CASES:
            sentence, expect = case[0], case[1]
            forbid = case[2] if len(case) > 2 else []
            before_log = await pg.evaluate("document.getElementById('log').children.length")
            before_and = await pg.evaluate("window.__and.length")
            if sentence.startswith("js:"):
                await pg.evaluate(sentence[3:]); continue
            await pg.evaluate("q => { const i = document.getElementById('input'); i.value = q; document.getElementById('form').requestSubmit(); }", sentence)
            await pg.wait_for_timeout(250)
            try: await pg.wait_for_function("!busy", timeout=15000)
            except Exception: pass
            await pg.wait_for_timeout(600)
            out = await pg.evaluate("n => [...document.getElementById('log').children].slice(n).map(e => e.textContent).join(' | ')", before_log)
            calls = await pg.evaluate("n => window.__and.slice(n).join(' | ')", before_and)
            hay = out + " || " + calls
            missing = [e for e in expect if e not in hay]
            wrong = [f for f in forbid if f in hay]
            if missing or wrong: fail += 1; print(f"✗ {sentence}\n    fehlt: {missing}  falsch: {wrong}\n    bekam: {hay[:300]}")
            else: ok += 1; print(f"✓ {sentence}")
        # KI-Stimme: Satz für Satz über Gemini, mit Vorab-Laden des nächsten Satzes
        await pg.evaluate("() => { gemAllModels.push('models/gemini-test-flash-tts'); aiVoiceName = 'Charon'; assistantSay('Das ist der erste Satz. Und hier kommt der zweite Satz.'); }")
        await pg.wait_for_timeout(2500)
        if len(TTS_HITS) >= 2 and not await pg.evaluate("speaking"): ok += 1; print("✓ KI-Stimme spricht Satz für Satz")
        else: fail += 1; print(f"✗ KI-Stimme: {len(TTS_HITS)} Anfragen, speaking={await pg.evaluate('speaking')}")
        await pg.evaluate("() => { aiVoiceName = ''; }")
        # Genaue KI-Erkennung: Aufnahme (nachgebaut) → Gemini schreibt mit → Befehl läuft
        before_log = await pg.evaluate("document.getElementById('log').children.length")
        await pg.evaluate("""() => { ZGAndroid.recStart = () => { setTimeout(() => { __zgRec.emit({type:'speech', sid: 7}); __zgRec.emit({type:'end', sid: 7, info:'ok'}); }, 150); return 7; };
          ZGAndroid.recStop = () => {}; ZGAndroid.recAbort = () => {}; ZGAndroid.recTake = () => 'UklGRg==';
          aiEarOn = true; if (rec) { rec.onend = null; rec = null; } listening = false; listen(); }""")
        await pg.wait_for_timeout(2500)
        out = await pg.evaluate("n => [...document.getElementById('log').children].slice(n).map(e => e.textContent).join(' | ')", before_log)
        if "Einkaufsliste" in out: ok += 1; print("✓ KI-Erkennung versteht Sprache und führt Befehl aus")
        else: fail += 1; print("✗ KI-Erkennung:", out[:300], await pg.evaluate("() => JSON.stringify({u: aiEarUsable(), busy, listening, speaking, key: !!geminiKey, m: geminiModel, inp: input.value, ph: input.placeholder})"))
        await pg.evaluate("() => { aiEarOn = false; }")
        # Android Auto: unsichtbare App bekommt Aufnahme, schreibt mit, antwortet auf dem Auto-Bildschirm
        car = await b.new_page()
        await car.route("**/*", route)
        car.on("pageerror", lambda e: errs.append("Auto: " + str(e)))
        await car.add_init_script(FAKE_ANDROID + """
          window.__car = []; ZGAndroid.isCar = () => true; ZGAndroid.carShow = (w, t) => window.__car.push(w + ': ' + t);
          ZGAndroid.carState = s => window.__car.push('state: ' + s); ZGAndroid.carListen = () => window.__car.push('listen');
          ZGAndroid.carTake = () => 'UklGRg==';""")
        await car.goto(PAGE)
        await car.wait_for_timeout(2500)
        await car.evaluate("() => __zgCarAudio()")
        await car.wait_for_timeout(3000)
        got = await car.evaluate("() => window.__car.join(' | ')")
        if "du: Was steht auf der Einkaufsliste?" in got and "jarvis:" in got and "state: bereit" in got: ok += 1; print("✓ Android Auto: Sprechen → Antwort auf dem Auto-Bildschirm")
        else: fail += 1; print("✗ Android Auto:", got[:400])
        # „Hey Jarvis“ im Auto (ohne Knopf): Handy-Mikrofon → Gemini schreibt mit → Antwort aufs Auto
        await car.evaluate("""() => { window.__car = []; ZGAndroid.recStart = () => { setTimeout(() => { __zgRec.emit({type:'speech', sid: 9}); __zgRec.emit({type:'end', sid: 9, info:'ok'}); }, 150); return 9; };
          ZGAndroid.recStop = () => {}; ZGAndroid.recAbort = () => {}; ZGAndroid.recTake = () => 'UklGRg=='; __zgWake(); }""")
        await car.wait_for_timeout(3000)
        got = await car.evaluate("() => window.__car.join(' | ')")
        if "Ich höre zu" in got and "du: Was steht auf der Einkaufsliste?" in got and "state: bereit" in got: ok += 1; print("✓ Android Auto: „Hey Jarvis“ ohne Knopf")
        else: fail += 1; print("✗ Android Auto Hey Jarvis:", got[:400])
        await car.evaluate("() => __zgCarAsk('Schreib Papa auf WhatsApp hallo')")
        await car.wait_for_timeout(1500)
        got = await car.evaluate("() => window.__car.join(' | ')")
        if "im Auto nicht schicken" in got: ok += 1; print("✓ Android Auto: WhatsApp wird im Auto freundlich abgelehnt")
        else: fail += 1; print("✗ Android Auto WhatsApp:", got[-300:])
        if errs: fail += 1; print("✗ JavaScript-Fehler:", errs)
        await b.close()
    print(f"\n{ok} bestanden, {fail} fehlgeschlagen")
    sys.exit(1 if fail else 0)

asyncio.run(main())
