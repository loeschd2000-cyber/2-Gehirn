  /* =====================================================================
     EXTRAS: Gedächtnis, Wetter, Listen, Erinnerungen, Lernmodus, Stundenplan,
     Budget, Kurs-Alarm, Navigation, Timer, Morgen-Briefing
     ===================================================================== */

  // ---------- Kleine Datenablage, die wie die Chats überall mitwandert (Handy, PC, Drive) ----------
  const DATA_PREFIX = "zg-data-";
  function dataGet(name, def) { const c = chats.find(x => x.id === DATA_PREFIX + name); return c && c.data !== undefined ? c.data : def; }
  function dataSet(name, val) {
    const id = DATA_PREFIX + name, now = Date.now();
    let c = chats.find(x => x.id === id);
    if (!c) { c = { id, title: "⚙ " + name, created: now, updated: now, messages: [], hidden: true }; chats.push(c); }
    c.data = val; c.updated = now; c.hidden = true;
    saveLocal(); scheduleDriveSave(); uploadChat(c);
    if (/^(birthdays|exams|budgets)$/.test(name)) { try { proactiveSync(); renderHello(); } catch {} }
  }
  const clean = t => t.trim().replace(/^(?:(?:hey\s+|hallo\s+|ok\s+)?jarvis[,\s]+)/i, "").replace(/^(?:bitte|kannst\s+du(?:\s+bitte)?|könntest\s+du)\s+/i, "").replace(/\s+bitte$/i, "").replace(/[.!?]+$/, "").trim();
  const cap = x => x ? x.charAt(0).toUpperCase() + x.slice(1) : x;
  const NUMW2 = { ein: 1, eine: 1, einen: 1, einer: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12, fünfzehn: 15, zwanzig: 20, dreißig: 30, vierzig: 40, fünfzig: 50, sechzig: 60, neunzig: 90, hundert: 100, halbe: 0.5, halben: 0.5 };
  const numVal = w => { if (w == null) return NaN; const n = parseFloat(String(w).replace(/\./g, "").replace(",", ".")); return isNaN(n) ? (NUMW2[String(w).toLowerCase()] ?? NaN) : n; };
  const MONTHS_DE = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
  const monthNum = w => { w = (w || "").toLowerCase().replace(/\.$/, ""); const i = MONTHS_DE.findIndex(m => m.startsWith(w.slice(0, 3))); return i >= 0 ? i + 1 : +w || NaN; };
  /** „15. Oktober“, „15.10.“, „nächsten Montag“, „morgen“ → zukünftiges Datum */
  function futureDate(t) {
    const d = new Date(); d.setHours(12, 0, 0, 0);
    if (/übermorgen/.test(t)) { d.setDate(d.getDate() + 2); return d; }
    if (/\bmorgen\b/.test(t)) { d.setDate(d.getDate() + 1); return d; }
    let m = /(\d{1,2})\.\s*(\d{1,2})\.?(?:\s*(\d{4}))?/.exec(t) || /(\d{1,2})\.?\s+(januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)/i.exec(t);
    if (m) { const x = new Date(d); x.setMonth(monthNum(m[2]) - 1, +m[1]); if (m[3]) x.setFullYear(+m[3]); else if (x < d) x.setFullYear(x.getFullYear() + 1); return x; }
    const wd = TAGE.findIndex(w => t.includes(w));
    if (wd >= 0) { let add = (wd - d.getDay() + 7) % 7; if (add === 0) add = 7; d.setDate(d.getDate() + add); return d; }
    return null;
  }
  const dateSay = d => d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  // Später etwas sagen, aber erst wenn Jarvis gerade nicht selbst spricht oder nachdenkt
  function sayWhenIdle(msg, noteText) {
    const go = () => { if (busy || speaking) { setTimeout(go, 500); return; } if (noteText) note(noteText); assistantSay(msg); };
    go();
  }

  // ---------- 4) Gedächtnis: „Merk dir …“ ----------
  function memoryContext() {
    const f = dataGet("facts", []), b = dataGet("birthdays", []), me = dataGet("me", {});
    const parts = [];
    if (me.city) parts.push("Damian wohnt in " + me.city + ".");
    if (f.length) parts.push("Das hat Damian dir gesagt, damit du es dir merkst: " + f.slice(-40).map(x => x.t).join(" | "));
    if (b.length) parts.push("Geburtstage: " + b.map(x => `${x.name} am ${x.d}.${x.m}.`).join(", "));
    return parts.length ? "\n\nDein Gedächtnis über Damian (nutze es, wenn es passt, erwähne es nicht ungefragt):\n" + parts.join("\n") : "";
  }
  function birthdaysSoon(days = 1) {
    const out = [], today = new Date(); today.setHours(0, 0, 0, 0);
    for (const b of dataGet("birthdays", [])) {
      for (let k = 0; k <= days; k++) { const d = new Date(today); d.setDate(d.getDate() + k); if (d.getDate() === b.d && d.getMonth() + 1 === b.m) out.push({ ...b, inDays: k }); }
    }
    return out;
  }
  function handleMemory(text) {
    const t = clean(text), tl = t.toLowerCase();
    // Anrede: „Nenn mich Boss“, „Sag Chef zu mir“
    let an = /^(?:nenn|nenne|nennst)\s+(?:du\s+)?mich\s+(?:ab\s+(?:jetzt|sofort)\s+|in\s+zukunft\s+|bitte\s+|einfach\s+)*(.{2,30}?)$|^sag\s+(?:ab\s+(?:jetzt|sofort)\s+)?(.{2,30}?)\s+zu\s+mir$/i.exec(t);
    if (an) {
      const name = cap((an[1] || an[2]).replace(/^(?:einfach|nur)\s+/i, "").trim());
      const me = dataGet("me", {}); me.anrede = name; dataSet("me", me);
      assistantSay(`Alles klar, ${name}. So nenne ich dich ab jetzt.`);
      return true;
    }
    // Adressen für die Navigation
    let m = /^(?:merk\s+dir\s*[,:]?\s*)?(?:meine?\s+)?(adresse|zuhause|zu\s+hause|wohnung|berufsschule|schule|arbeit|betrieb|firma|ausbildungsbetrieb)\s+(?:ist|liegt|lautet)\s+(?:in\s+(?:der\s+)?|im\s+|bei\s+|am\s+)?(.+)$/i.exec(t);
    if (m && /merk|meine?/i.test(t)) {
      const key = /schule/i.test(m[1]) ? "school" : /arbeit|betrieb|firma/i.test(m[1]) ? "work" : "home";
      const me = dataGet("me", {}); me[key] = m[2].trim(); dataSet("me", me);
      assistantSay(`Gemerkt: ${key === "home" ? "Dein Zuhause" : key === "school" ? "Deine Berufsschule" : "Deine Arbeit"} ist ${m[2].trim()}.`);
      return true;
    }
    m = /^(?:merk\s+dir\s*[,:]?\s*)?ich\s+wohne\s+(?:in|im|bei)\s+(.+)$/i.exec(t);
    if (m) { const me = dataGet("me", {}); me.city = cap(m[1].trim()); delete me.geo; if (!me.home) me.home = me.city; dataSet("me", me); assistantSay(`Gemerkt: Du wohnst in ${me.city}. Das nehme ich ab jetzt fürs Wetter.`); return true; }
    // Geburtstage
    m = /^(?:merk\s+dir\s*[,:]?\s*)?(.+?)\s+hat\s+am\s+(\d{1,2})\.?\s*(\d{1,2}\.?|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+geburtstag/i.exec(t);
    if (m) {
      const name = m[1].replace(/^(?:mein(?:e|er)?|der|die|das)\s+/i, "").trim(), d = +m[2], mo = monthNum(m[3]);
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
        const b = dataGet("birthdays", []).filter(x => x.name.toLowerCase() !== name.toLowerCase()); b.push({ name: cap(name), d, m: mo }); dataSet("birthdays", b);
        assistantSay(`Gemerkt: ${cap(name)} hat am ${d}. ${cap(MONTHS_DE[mo - 1])} Geburtstag. Ich erinnere dich am Tag vorher im Briefing.`);
        return true;
      }
    }
    // Was weißt du über mich?
    if (/was\s+weißt\s+du\s+(?:alles\s+)?über\s+mich|was\s+hast\s+du\s+dir\s+gemerkt/i.test(tl)) {
      const f = dataGet("facts", []), b = dataGet("birthdays", []), me = dataGet("me", {});
      const lines = [...f.map(x => "• " + x.t), ...b.map(x => `🎂 ${x.name}: ${x.d}.${x.m}.`), ...(me.city ? ["🏠 wohnt in " + me.city] : []), ...(me.school ? ["🏫 Berufsschule: " + me.school] : []), ...(me.work ? ["🏭 Arbeit: " + me.work] : [])];
      if (!lines.length) { assistantSay("Ich habe mir noch nichts gemerkt. Sag zum Beispiel: Merk dir, mein Ausbilder heißt Herr Müller."); return true; }
      extraCard("🧠 Das weiß ich über dich", lines);
      assistantSay(`Ich habe mir ${lines.length} Dinge gemerkt, sie stehen jetzt im Chat.`);
      return true;
    }
    // Vergessen
    m = /^vergiss\s+(?:bitte\s+)?(?:das\s+mit\s+|dass\s+)?(.+)$/i.exec(t);
    if (m && !/^(es|das)$/i.test(m[1])) {
      const words = m[1].toLowerCase().split(/\s+/).filter(w => w.length > 1);
      if (!words.length) { assistantSay("Was genau soll ich vergessen?"); return true; }
      const f = dataGet("facts", []), keep = f.filter(x => !words.every(w => x.t.toLowerCase().includes(w)));
      const b = dataGet("birthdays", []), keepB = b.filter(x => !words.some(w => x.name.toLowerCase().includes(w)) || !/geburtstag/i.test(m[1]));
      const n = f.length - keep.length + b.length - keepB.length;
      if (!n) { assistantSay("Dazu habe ich nichts gespeichert."); return true; }
      dataSet("facts", keep); dataSet("birthdays", keepB);
      assistantSay(`Okay, vergessen.`); return true;
    }
    // Allgemein merken
    m = /^(?:merk\s+dir|speicher\s+dir|notier\s+dir|behalte?)\s*[,:]?\s*(?:dass\s+)?(.+)$/i.exec(t);
    if (m && m[1].length > 3 && !WALLET_INV.test(t)) {
      const f = dataGet("facts", []); f.push({ t: cap(m[1].trim()), ts: Date.now() }); dataSet("facts", f.slice(-200));
      assistantSay("Gemerkt."); return true;
    }
    return false;
  }

  // Karte mit Zeilen im Chat
  function extraCard(title, lines, sub) {
    const card = document.createElement("div"); card.className = "card";
    const b = document.createElement("b"); b.textContent = title; card.append(b);
    if (sub) { const s2 = document.createElement("span"); s2.className = "sub"; s2.textContent = sub; card.append(s2); }
    if (lines && lines.length) { const body = document.createElement("div"); body.className = "body"; fillRows(body, lines); card.append(body); }
    log.append(card); log.scrollTop = log.scrollHeight; return card;
  }

  // ---------- 2) Wetter (Open-Meteo, kostenlos) ----------
  const WCODE = { 0: "klar", 1: "überwiegend klar", 2: "teils bewölkt", 3: "bewölkt", 45: "neblig", 48: "neblig mit Reif", 51: "leichter Nieselregen", 53: "Nieselregen", 55: "starker Nieselregen", 56: "gefrierender Niesel", 57: "gefrierender Niesel", 61: "leichter Regen", 63: "Regen", 65: "starker Regen", 66: "gefrierender Regen", 67: "gefrierender Regen", 71: "leichter Schneefall", 73: "Schneefall", 75: "starker Schneefall", 77: "Schneegriesel", 80: "leichte Schauer", 81: "Schauer", 82: "heftige Schauer", 85: "Schneeschauer", 86: "starke Schneeschauer", 95: "Gewitter", 96: "Gewitter mit Hagel", 99: "Gewitter mit Hagel" };
  const WICON = c => c === 0 ? "☀️" : c <= 2 ? "🌤" : c === 3 ? "☁️" : c <= 48 ? "🌫" : c <= 67 || (c >= 80 && c <= 82) ? "🌧" : c <= 86 ? "❄️" : "⛈";
  async function geo(city) {
    const r = await fetchT("https://geocoding-api.open-meteo.com/v1/search?count=1&language=de&name=" + encodeURIComponent(city));
    const j = await r.json(); const g = j.results && j.results[0];
    if (!g) throw new Error(`Ich finde den Ort „${city}“ nicht.`);
    return { lat: g.latitude, lon: g.longitude, name: g.name };
  }
  async function weatherFor(city) {
    const me = dataGet("me", {});
    let g;
    if (!city || (me.city && city.toLowerCase() === me.city.toLowerCase())) {
      if (!me.city) return null;
      g = me.geo || await geo(me.city); if (!me.geo) { me.geo = g; dataSet("me", me); }
    } else g = await geo(city);
    const r = await fetchT(`https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&current=temperature_2m,weather_code,wind_speed_10m,apparent_temperature&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3`);
    const j = await r.json(); j.place = g.name; return j;
  }
  function weatherSentence(w, dayIdx) {
    const d = w.daily, code = d.weather_code[dayIdx], max = Math.round(d.temperature_2m_max[dayIdx]), min = Math.round(d.temperature_2m_min[dayIdx]), pp = d.precipitation_probability_max[dayIdx] || 0;
    const when = ["Heute", "Morgen", "Übermorgen"][dayIdx];
    let s = `${when} in ${w.place}: ${WCODE[code] || "wechselhaft"}, ${min} bis ${max} Grad, Regenrisiko ${pp} Prozent.`;
    if (dayIdx === 0 && w.current) s = `Gerade ${Math.round(w.current.temperature_2m)} Grad in ${w.place}. ` + s.replace(`${when} in ${w.place}: `, "Heute: ");
    const tips = [];
    if (max < 14) tips.push("Jacke mitnehmen"); if (pp >= 45) tips.push("Regenschirm einpacken"); if (max >= 26) tips.push("genug trinken");
    if (tips.length) s += " Tipp: " + tips.join(" und ") + ".";
    return { s, card: `${WICON(code)} ${when}: ${WCODE[code] || ""}, ${min}–${max} °C, Regen ${pp} %` };
  }
  async function handleWeather(text) {
    const t = clean(text), tl = t.toLowerCase();
    if (!/\b(wetter|regnet|regnen|regen\b|regenschirm|jacke|temperatur|wie\s+warm|wie\s+kalt|schneit|schnee|gewitter|sonne\s+scheinen|grad\s+(?:hat|ist|wird)|wird\s+es\s+(?:warm|kalt|heiß))/i.test(tl)) return false;
    const cm = /\b(?:in|für)\s+([A-ZÄÖÜ][\wäöüß-]+(?:\s+(?:am|an\s+der|ob\s+der)?\s*[A-ZÄÖÜ][\wäöüß-]+)?)/.exec(t);
    const city = cm && !/^(der|die|das|dem)$/i.test(cm[1]) ? cm[1] : null;
    if (!city && !dataGet("me", {}).city) { assistantSay("Für welchen Ort? Sag einmal: Merk dir, ich wohne in Haßfurt. Dann weiß ich es für immer."); return true; }
    busy = true; refreshUi();
    try {
      const w = await weatherFor(city);
      busy = false; refreshUi();
      const idx = /übermorgen/.test(tl) ? 2 : /\bmorgen\b/.test(tl) ? 1 : 0;
      const a = weatherSentence(w, idx);
      extraCard("Wetter · " + w.place, [0, 1, 2].map(i => weatherSentence(w, i).card));
      assistantSay(a.s);
    } catch (e) { busy = false; refreshUi(); assistantSay("Das Wetter bekomme ich gerade nicht. " + (e.message || "")); }
    return true;
  }

  // ---------- 3) Listen (Einkauf, To-dos) + Erinnerungen ----------
  const LIST_RE = "(einkaufsliste|einkaufszettel|einkauf|to-?do-?liste|to-?dos?|todo-?liste|todos?|aufgabenliste|aufgaben)";
  const listKey = w => /einkauf/i.test(w) ? "einkauf" : "todo";
  const listName = k => k === "einkauf" ? "Einkaufsliste" : "To-do-Liste";
  const splitItems = s => s.split(/\s*,\s*|\s+und\s+/i).map(x => x.replace(/^(?:noch\s+|ein(?:e|en)?\s+|etwas\s+)/i, "").trim()).filter(Boolean).map(cap);
  function handleLists(text) {
    const t = clean(text), tl = t.toLowerCase();
    if (!new RegExp(LIST_RE, "i").test(tl) && !/^erledigt\b|\bist\s+erledigt$/i.test(tl)) return false;
    const lists = dataGet("lists", { einkauf: [], todo: [] });
    let m;
    // hinzufügen
    if ((m = new RegExp("^(?:setz|setze|schreib|schreibe|pack|packe|tu|tue|füg|füge|nimm|trag|trage)\\s+(.+?)\\s+(?:auf|zu|in|an)\\s+(?:die|meine|der|meiner|den|meinen|meinem|dem)?\\s*" + LIST_RE + "(?:\\s+(?:dazu|hinzu|ein|drauf))?$", "i").exec(t))) {
      const k = listKey(m[2]), items = splitItems(m[1]);
      lists[k] = [...(lists[k] || []), ...items.filter(i => !(lists[k] || []).some(x => x.toLowerCase() === i.toLowerCase()))];
      dataSet("lists", lists);
      assistantSay(`${items.join(" und ")} ${items.length > 1 ? "stehen" : "steht"} auf der ${listName(k)}.`);
      return true;
    }
    // Liste leeren
    if ((m = new RegExp("^(?:lösch\\w*|leer\\w*|mach\\w*)\\s+(?:die|meine)\\s+" + LIST_RE + "(?:\\s+(?:leer|komplett|ganz))?$", "i").exec(t))) {
      const k = listKey(m[1]); lists[k] = []; dataSet("lists", lists); assistantSay(`Die ${listName(k)} ist jetzt leer.`); return true;
    }
    // abhaken / streichen
    if ((m = new RegExp("^(?:streich\\w*|lösch\\w*|entfern\\w*|hak\\w*)\\s+(.+?)\\s+(?:von|aus|auf)\\s+(?:der|meiner|den|meinen|dem|meinem)?\\s*" + LIST_RE + "(?:\\s+ab)?$", "i").exec(t)) || (m = /^(?:erledigt\s*[:,]?\s*(.+)|(.+?)\s+ist\s+erledigt)$/i.exec(t))) {
      const what = (m[1] || m[2] || "").toLowerCase(), k = m[3] ? listKey(m[3]) : (lists.todo || []).some(x => x.toLowerCase().includes(what)) ? "todo" : "einkauf";
      const before = (lists[k] || []).length; lists[k] = (lists[k] || []).filter(x => !x.toLowerCase().includes(what) && !what.includes(x.toLowerCase()));
      if (lists[k].length === before) { assistantSay(`„${cap(what)}“ finde ich nicht auf der ${listName(k)}.`); return true; }
      dataSet("lists", lists); assistantSay(`Abgehakt. Auf der ${listName(k)} ${lists[k].length === 1 ? "steht noch ein Punkt" : lists[k].length ? `stehen noch ${lists[k].length} Punkte` : "steht nichts mehr"}.`);
      return true;
    }
    // anzeigen / vorlesen – nur bei echten Listen-Wörtern, nicht bei „für den Einkauf ausgegeben“ oder „Aufgaben einer SPS“
    if ((m = /(einkaufsliste|einkaufszettel|to-?do-?liste|to-?dos?|todo-?liste|todos?|aufgabenliste|meine\s+aufgaben)/.exec(tl)) && !/(ausgegeben|ausgeben|euro|kosten|erklär|was\s+(?:ist|sind)\s+(?:die|eine?))/.test(tl)) {
      const k = listKey(m[1]), items = lists[k] || [];
      if (!items.length) { assistantSay(`Deine ${listName(k)} ist leer.`); return true; }
      extraCard((k === "einkauf" ? "🛒 " : "✅ ") + listName(k), items.map(x => "☐ " + x));
      assistantSay(`Auf deiner ${listName(k)}: ${items.join(", ")}.`);
      return true;
    }
    return false;
  }
  function handleReminder(text) {
    const t = clean(text), tl = t.toLowerCase();
    if (/welche\s+erinnerungen|meine\s+erinnerungen|erinnerungen\s+(?:zeigen|anzeigen)/.test(tl)) {
      if (!AND || !AND.reminderList) { assistantSay("Erinnerungen gibt es nur in der Android-App."); return true; }
      const l = JSON.parse(AND.reminderList() || "[]").sort((a, b) => a.at - b.at);
      if (!l.length) { assistantSay("Du hast keine Erinnerungen gestellt."); return true; }
      extraCard("⏰ Erinnerungen", l.map(x => `${new Date(x.at).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} – ${x.text}`));
      assistantSay(`Du hast ${l.length} Erinnerung${l.length > 1 ? "en" : ""}. Die nächste: ${l[0].text}, ${new Date(l[0].at).toLocaleString("de-DE", { weekday: "long", hour: "2-digit", minute: "2-digit" })}.`);
      return true;
    }
    if (/lösch\w*\s+(?:alle\s+)?(?:meine\s+)?erinnerungen/.test(tl)) { if (AND && AND.reminderCancel) AND.reminderCancel(-1); assistantSay("Alle Erinnerungen sind gelöscht."); return true; }
    if (!/\berinner\w*\s+mich\b|\bsag\s+mir\s+(?:um|in|morgen|heute)\b/.test(tl) || /tagebuch/.test(tl)) return false;
    const when = parseAlarmTime(tl);
    if (!when) { assistantSay("Wann soll ich dich erinnern? Sag zum Beispiel: Erinner mich morgen um 16 Uhr an die Hausaufgaben."); return true; }
    let what = t.replace(/^.*?\b(?:erinner\w*\s+mich|sag\s+mir)\b/i, "")
      .replace(/(?:^|\s)übermorgen\b/gi, " ")
      .replace(/\b(heute|morgen|am\s+\w+tag|am\s+mittwoch|in\s+\S+\s+(?:minuten?|stunden?)|um\s+\S+(?:\s*uhr(?:\s+\d{1,2})?)?|halb\s+\S+|viertel\s+(?:vor|nach)\s+\S+|\d{1,2}[:.]\d{2}\s*(?:uhr)?|abends?|morgens?|nachmittags?|früh|heute\s+abend|mittags?)\b/gi, " ")
      .replace(/^\s*(?:,|daran|an|dass|zu)\s+/i, "").replace(/\s+/g, " ").trim();
    what = what.replace(/^(?:an\s+|dass\s+|daran,?\s*(?:dass\s+)?)/i, "").trim() || "Erinnerung";
    const at = when.at.getTime();
    if (AND && AND.reminderAdd) {
      AND.reminderAdd(String(at), cap(what));
      assistantSay(`Okay, ich erinnere dich ${when.rel ? "um " + zeitText(when.h, when.m) : (when.dayWord ? when.dayWord + " um " : "um ") + zeitText(when.h, when.m)} an: ${what}.`);
    } else {
      const ms = at - Date.now();
      if (ms > 12 * 3600000) { assistantSay("Am PC kann ich nur Erinnerungen für die nächsten Stunden stellen, und nur solange das Fenster offen ist. Sag es mir am Handy, dann klappt es immer."); return true; }
      setTimeout(() => sayWhenIdle("Erinnerung: " + what, "⏰ Erinnerung: " + what), ms);
      assistantSay(`Okay, um ${zeitText(when.h, when.m)} erinnere ich dich an: ${what}. Lass dafür dieses Fenster offen.`);
    }
    return true;
  }

  // ---------- 10) Timer ----------
  function handleTimer(text) {
    const tl = clean(text).toLowerCase();
    if (!/\btimer\b|\bstoppuhr\b|\bweck\s+mich\s+in\b|\bsag\s+bescheid\s+in\b/.test(tl)) return false;
    const m = /(\d+(?:[.,]\d+)?|eine?n?|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|fünfzehn|zwanzig|dreißig|vierzig|fünfzig|sechzig|neunzig|halbe[n]?)\s*(sekunden?|minuten?|min|stunden?|std)\b/.exec(tl);
    if (!m) { assistantSay("Wie lange? Sag zum Beispiel: Stell einen Timer auf 12 Minuten."); return true; }
    let sec = numVal(m[1]) * (/^s/.test(m[2]) ? 1 : /^(stunde|std)/.test(m[2]) ? 3600 : 60);
    const extra = /und\s+(\d+|eine?|zwei|drei|vier|fünf|zehn|zwanzig|dreißig)\s*(minuten?|sekunden?)/.exec(tl.slice(m.index + m[0].length));
    if (extra) sec += numVal(extra[1]) * (/^s/.test(extra[2]) ? 1 : 60);
    const lm = /\bfür\s+(?:die\s+|den\s+|das\s+)?([a-zäöüß ]{3,30})$/.exec(tl);
    const label = lm ? cap(lm[1].trim()) : "Jarvis";
    sec = Math.round(sec);
    const say = sec >= 3600 ? `${Math.floor(sec / 3600)} Stunde${sec >= 7200 ? "n" : ""}${sec % 3600 ? " und " + Math.round(sec % 3600 / 60) + " Minuten" : ""}` : sec >= 60 ? `${Math.round(sec / 60)} Minute${sec >= 120 ? "n" : ""}` : `${sec} Sekunden`;
    if (AND && AND.timer) { AND.timer(sec, label); assistantSay(`Timer auf ${say} läuft.`); }
    else { setTimeout(() => { sayWhenIdle("Dein Timer ist abgelaufen.", "⏱ Timer abgelaufen: " + label); try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch {} }, sec * 1000); assistantSay(`Timer auf ${say} läuft. Lass das Fenster offen.`); }
    lastViaVoice = false;
    return true;
  }

  // ---------- 9) Navigation ----------
  function handleNav(text) {
    const t = clean(text), tl = t.toLowerCase();
    let m = /^(?:navigier\w*|bring|fahr\w*|führ\w*)\s+(?:mich\s+)?(?:bitte\s+)?(?:nach|zu|zur|zum|in\s+die|ins|in)\s+(.+)$/i.exec(t) || /^(?:route|weg|navigation)\s+(?:nach|zu|zur|zum)\s+(.+)$/i.exec(t);
    const start = !!m;
    if (!m) m = /wie\s+(?:lange|weit)\s+(?:brauch\w*|dauert\w*|fahr\w*|ist\s+es|sind\s+es|hab\w*)\s+(?:ich\s+)?(?:es\s+)?(?:bis\s+)?(?:nach|zu|zur|zum|in\s+die|ins|in)\s+(.+)$/i.exec(t);
    if (!m) return false;
    let dest = m[1].replace(/\s+(?:mit\s+dem\s+\w+|zu\s+fuß|mit\s+(?:bus|bahn|zug|öffis?|rad|fahrrad|auto))$/i, "").trim();
    const mode = /zu\s+fuß|laufen|gehen/.test(tl) ? "walk" : /fahrrad|\brad\b/.test(tl) ? "bike" : /\bbus\b|bahn|zug|öffi|öffentlich/.test(tl) ? "transit" : "drive";
    const me = dataGet("me", {});
    const key = /^(?:hause|haus|mir\s+nach\s+hause|nachhause|daheim)$/i.test(dest) || /nach\s+hause/.test(tl) ? "home" : /^(?:der\s+|die\s+)?(?:berufs)?schule$/i.test(dest) ? "school" : /^(?:der\s+|die\s+|dem\s+)?(?:arbeit|betrieb|firma|ausbildung)$/i.test(dest) ? "work" : null;
    if (key) {
      if (!me[key]) { assistantSay(`Die Adresse kenne ich noch nicht. Sag einmal: Merk dir, meine ${key === "home" ? "Adresse" : key === "school" ? "Berufsschule" : "Arbeit"} ist … und dann die Adresse.`); return true; }
      dest = me[key];
    }
    if (AND && AND.maps) AND.maps(dest, mode, start);
    else window.open("https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(dest) + "&travelmode=" + ({ walk: "walking", bike: "bicycling", transit: "transit", drive: "driving" })[mode], "_blank");
    lastViaVoice = false;
    const where = key ? { home: "nach Hause", school: "zur Berufsschule", work: "zur Arbeit" }[key] : "nach " + dest;
    assistantSay(start ? `Ich starte die Navigation ${where}.` : `Ich zeige dir die Route ${where}, die Fahrzeit steht in Google Maps.`);
    return true;
  }

  // ---------- 7) Budget ----------
  const BUDGET_CATS = [["Essen & Trinken", /essen|restaurant|fast ?food|liefer/], ["Lebensmittel", /lebensmittel|einkauf|supermarkt/], ["Tanken & Auto", /tank|sprit|auto/], ["Shopping", /shopping|klamotten|online|amazon/], ["Abos & Streaming", /abo|streaming/], ["Sport & Freizeit", /freizeit|sport|fitness/], ["Krypto & Trading", /krypto|crypto|trading/]];
  function budgetWarnings(a) {
    const b = dataGet("budgets", { total: 0, cats: {} }), out = [];
    const m = a.months[a.cur]; if (!m) return out;
    const day = new Date().getDate(), days = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    if (b.total) { const pct = m.out / b.total * 100; if (pct >= 80) out.push(`Du hast schon ${Math.round(pct)} Prozent deines Monatsbudgets von ${eur(b.total)} ausgegeben${pct >= 100 ? ", du bist drüber" : ""}.`); else if (days - day <= 3) out.push(`Bis Monatsende sind von deinem Budget noch ${eur(b.total - m.out)} übrig.`); }
    for (const [c, lim] of Object.entries(b.cats || {})) { const v = m.cats[c] || 0; if (lim && v / lim >= .8) out.push(`${c}: ${eur(v)} von ${eur(lim)} Budget${v > lim ? ", schon drüber" : ""}.`); }
    return out;
  }
  function handleBudget(text) {
    const tl = clean(text).toLowerCase();
    if (!/budget|\blimit\b/.test(tl)) return false;
    const b = dataGet("budgets", { total: 0, cats: {} });
    const m = /(?:auf|von|ist|sind|:)?\s*(\d+(?:[.,]\d+)?)\s*(?:euro|€)/.exec(tl) || /(\d+(?:[.,]\d+)?)/.exec(tl);
    if (/(setz|stell|mein|ist|auf|leg|mach)/.test(tl) && m && !/wie\s+(?:steht|sieht|viel)/.test(tl)) {
      const v = numVal(m[1]); const cat = BUDGET_CATS.find(([, re]) => re.test(tl));
      if (cat) b.cats = { ...(b.cats || {}), [cat[0]]: v }; else b.total = v;
      dataSet("budgets", b);
      assistantSay(cat ? `Budget für ${cat[0]}: ${eur(v)} im Monat. Ich warne dich ab 80 Prozent.` : `Dein Monatsbudget ist jetzt ${eur(v)}. Ich warne dich ab 80 Prozent.`);
      return true;
    }
    if (!/\bwie\b/.test(tl) && /\b(lösch\w*|entfern\w*)\b|^(?:mach\w*\s+|schalt\w*\s+)?(?:das\s+|die\s+|mein\w*\s+)?budgets?\s+aus$/.test(tl)) { dataSet("budgets", { total: 0, cats: {} }); assistantSay("Alle Budgets sind gelöscht."); return true; }
    // Stand abfragen
    let d = null; try { d = AND && AND.bankCached ? JSON.parse(AND.bankCached() || "null") : null; } catch {}
    if (!d || !d.ok) { assistantSay(b.total ? `Dein Monatsbudget ist ${eur(b.total)}. Für den Stand brauche ich dein verbundenes Konto am Handy.` : "Du hast noch kein Budget. Sag zum Beispiel: Setz mein Monatsbudget auf 600 Euro."); return true; }
    const a = finAnalyze(d), mo = a.months[a.cur] || { out: 0, cats: {} };
    const lines = []; if (b.total) lines.push(`Gesamt: ${eur(mo.out)} von ${eur(b.total)} (${Math.round(mo.out / b.total * 100)} %)`);
    for (const [c, lim] of Object.entries(b.cats || {})) lines.push(`${c}: ${eur(mo.cats[c] || 0)} von ${eur(lim)}`);
    if (!lines.length) { assistantSay("Du hast noch kein Budget. Sag zum Beispiel: Setz mein Monatsbudget auf 600 Euro."); return true; }
    extraCard("💶 Budget · " + monthName(a.cur), lines);
    const w = budgetWarnings(a);
    assistantSay(b.total ? `Du hast diesen Monat ${eur(mo.out)} von ${eur(b.total)} ausgegeben, noch ${eur(Math.max(0, b.total - mo.out))} übrig.` + (w.length ? " " + w.filter(x => !/Monatsbudgets|Monatsende/.test(x)).join(" ") : "") : w.join(" ") || "Alles im Rahmen.");
    return true;
  }

  // ---------- 8) Kurs-Alarm (CoinGecko) ----------
  const COINS = { sol: "solana", solana: "solana", btc: "bitcoin", bitcoin: "bitcoin", eth: "ethereum", ethereum: "ethereum", bonk: "bonk", doge: "dogecoin", dogecoin: "dogecoin", xrp: "ripple", ripple: "ripple", jup: "jupiter-exchange-solana", jupiter: "jupiter-exchange-solana", wif: "dogwifcoin", pepe: "pepe", ada: "cardano", cardano: "cardano", bnb: "binancecoin", ton: "the-open-network", sui: "sui", trump: "official-trump", pengu: "pudgy-penguins", ray: "raydium", raydium: "raydium" };
  async function coinId(sym) {
    const k = sym.toLowerCase(); if (COINS[k]) return { id: COINS[k], sym: sym.toUpperCase() };
    const r = await fetchT("https://api.coingecko.com/api/v3/search?query=" + encodeURIComponent(sym)); const j = await r.json();
    const c = j.coins && j.coins[0]; if (!c) throw new Error(`Den Coin „${sym}“ finde ich nicht.`);
    return { id: c.id, sym: (c.symbol || sym).toUpperCase() };
  }
  async function handlePriceAlert(text) {
    const tl = clean(text).toLowerCase();
    if (/(welche|meine|zeig\w*)\s+(?:kurs-?\s*)?(?:alarme?|preis-?\s*alarme?)/.test(tl) || /kurs-?\s*alarme?\s+(?:anzeigen|zeigen)/.test(tl)) {
      if (!AND || !AND.priceAlertList) { assistantSay("Kurs-Alarme gibt es nur in der Android-App."); return true; }
      const l = JSON.parse(AND.priceAlertList() || "[]");
      if (!l.length) { assistantSay("Du hast keine Kurs-Alarme."); return true; }
      extraCard("📈 Kurs-Alarme", l.map(x => `${x.sym} ${x.below ? "unter" : "über"} ${x.price} ${x.cur === "eur" ? "€" : "$"}`));
      assistantSay(`Du hast ${l.length} Kurs-Alarm${l.length > 1 ? "e" : ""}.`); return true;
    }
    if (/lösch\w*\s+(?:alle\s+)?(?:meine\s+)?(?:kurs-?\s*|preis-?\s*)alarme?/.test(tl)) { if (AND && AND.priceAlertCancel) AND.priceAlertCancel(-1); assistantSay("Alle Kurs-Alarme sind gelöscht."); return true; }
    const m = /(?:wenn|sobald|falls)\s+(?:der|die|das|mein\w*\s+)?([a-z0-9$]{2,15})\s+(?:unter|über|auf|die|den)?\s*(?:marke\s+(?:von\s+)?)?(unter|über|auf)?\s*([\d.,]+)\s*(dollar|\$|usd|euro|€|eur|cent)?\s*(fällt|steigt|geht|kommt|ist|erreicht|springt)?/.exec(tl);
    if (!m || !/(bescheid|benachrichtig|alarm|meld|sag\s+mir|informier|ping)/.test(tl)) return false;
    if (!AND || !AND.priceAlertAdd) { assistantSay("Kurs-Alarme gehen nur in der Android-App, weil das Handy im Hintergrund nachschauen muss."); return true; }
    const cur = /euro|€|eur/.test(m[4] || "") ? "eur" : "usd";
    let price = numVal(m[3]); if (m[4] === "cent") price = price / 100;
    busy = true; refreshUi();
    try {
      const c = await coinId(m[1].replace("$", ""));
      const pr = await (await fetchT(`https://api.coingecko.com/api/v3/simple/price?ids=${c.id}&vs_currencies=usd,eur`)).json();
      const now = pr[c.id] && pr[c.id][cur];
      busy = false; refreshUi();
      let below = /unter|fällt/.test(tl) ? true : /über|steigt/.test(tl) ? false : (now != null ? now > price : true);
      AND.priceAlertAdd(c.id, c.sym, below, String(price), cur);
      const sign = cur === "eur" ? "Euro" : "Dollar";
      assistantSay(`Okay. Ich sage dir Bescheid, wenn ${c.sym} ${below ? "unter" : "über"} ${price.toLocaleString("de-DE")} ${sign} ${below ? "fällt" : "steigt"}.` + (now != null ? ` Gerade steht ${c.sym} bei ${now.toLocaleString("de-DE", { maximumFractionDigits: now < 1 ? 6 : 2 })} ${sign}.` : "") + " Ich schaue etwa alle 15 Minuten nach.");
    } catch (e) { busy = false; refreshUi(); assistantSay("Das hat nicht geklappt. " + (e.message || "")); }
    return true;
  }

  // ---------- 6) Stundenplan + Arbeiten ----------
  const WD_KEYS = ["so", "mo", "di", "mi", "do", "fr", "sa"];
  function handleSchool(text) {
    const t = clean(text), tl = t.toLowerCase();
    let m = /^(?:merk\s+dir\s*[,:]?\s*)?(?:mein\s+)?stundenplan\s+(?:am\s+|für\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag)\s*(?:ist|:|,)?\s*(.+)$/i.exec(t)
      || /^(?:merk\s+dir\s*[,:]?\s*)?(?:am|jeden)\s+(montag|dienstag|mittwoch|donnerstag|freitag|samstag)\s+(?:habe?\s+ich|hab\s+ich|haben\s+wir)\s+(?:in\s+der\s+schule\s+)?(.+)$/i.exec(t);
    if (m) {
      const tt = dataGet("timetable", {}), k = WD_KEYS[TAGE.indexOf(m[1].toLowerCase())];
      if (/^(?:frei|keine?\s+schule|nichts)$/i.test(m[2].trim())) delete tt[k]; else tt[k] = splitItems(m[2]);
      dataSet("timetable", tt);
      assistantSay(tt[k] ? `Gemerkt: ${cap(m[1])} hast du ${tt[k].join(", ")}.` : `Gemerkt: ${cap(m[1])} ist keine Schule.`); return true;
    }
    // Arbeit / Prüfung eintragen
    m = /\b(arbeit|klausur|test|prüfung|schulaufgabe|kurzarbeit|ex|lernzielkontrolle|lzk)\b/.exec(tl);
    const isQuestion = /\?\s*$/.test(text) || /^(?:hab|habe|haben|hast|ist|sind|was|wann|welche\w*|wie|gibt)\b/.test(tl);
    const isAddress = /\bmeine?\s+(?:arbeit|betrieb|firma|schule|berufsschule)\s+(?:ist|liegt)\b/.test(tl);
    const setExam = m && !isQuestion && !isAddress && /(schreiben\s+wir|haben\s+wir|hab\s+ich|habe\s+ich|ist\s+(?:eine?|die)|trag\w*)/.test(tl) && !/(wann|welche|nächste)/.test(tl);
    if (setExam) {
      const d = futureDate(tl);
      if (!d) { assistantSay("An welchem Tag? Sag zum Beispiel: Am 15. Oktober schreiben wir eine Arbeit in SPS."); return true; }
      const sm = /(?:in|über|aus|zu|fach)\s+([a-zäöüß0-9 -]{2,30}?)(?:\s+(?:schreiben|haben|am)\b|$)/.exec(tl.slice(m.index)) || /(?:in|über|aus)\s+([a-zäöüß0-9 -]{2,30})/.exec(tl);
      const subject = sm ? sm[1].trim().replace(/^(?:der|die|dem)\s+/, "").toUpperCase().length <= 4 ? sm[1].trim().toUpperCase() : cap(sm[1].trim()) : "";
      const ex = dataGet("exams", []).filter(x => new Date(x.date) >= new Date(Date.now() - 86400000));
      ex.push({ date: dayKey(d), subject, kind: cap(m[1]) }); dataSet("exams", ex);
      (async () => { try { await getToken(true); const next = new Date(d); next.setDate(d.getDate() + 1);
        await gApi("https://www.googleapis.com/calendar/v3/calendars/primary/events", { method: "POST", body: JSON.stringify({ summary: `📝 ${cap(m[1])}${subject ? ": " + subject : ""}`, start: { date: dayKey(d) }, end: { date: dayKey(next) }, colorId: "11" }) }); } catch {} })();
      assistantSay(`Eingetragen: ${cap(m[1])}${subject ? " in " + subject : ""} am ${dateSay(d)}. Ich erinnere dich im Briefing daran, wenn sie näher kommt.`);
      return true;
    }
    // nächste Arbeit
    if (m && /(wann|nächste|welche|haben\s+wir|kommen)/.test(tl)) {
      const ex = dataGet("exams", []).filter(x => new Date(x.date + "T23:59") >= new Date()).sort((a, b) => a.date.localeCompare(b.date));
      if (!ex.length) { assistantSay("Ich habe keine Arbeiten eingetragen. Sag zum Beispiel: Am 15. Oktober schreiben wir eine Arbeit in SPS."); return true; }
      const n = ex[0], d = new Date(n.date + "T12:00"), days = Math.round((d - new Date().setHours(12, 0, 0, 0)) / 86400000);
      if (ex.length > 1) extraCard("📝 Anstehende Arbeiten", ex.map(x => `${new Date(x.date + "T12:00").toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })} – ${x.kind}${x.subject ? " " + x.subject : ""}`));
      assistantSay(`Die nächste ${n.kind}${n.subject ? " in " + n.subject : ""} ist ${days === 0 ? "heute" : days === 1 ? "morgen" : "in " + days + " Tagen, am " + dateSay(d)}.` + (days <= 7 && days > 0 ? " Soll ich dich abfragen? Sag einfach: Frag mich " + (n.subject ? n.subject + " ab" : "ab") + "." : ""));
      return true;
    }
    // Stundenplan abfragen
    if (/(schule|stundenplan|fächer|unterricht)/.test(tl) && /(was|welche|wie|hab|haben|zeig)/.test(tl)) {
      const tt = dataGet("timetable", {});
      if (!Object.keys(tt).length) { assistantSay("Ich kenne deinen Stundenplan noch nicht. Sag zum Beispiel: Stundenplan Montag: SPS, Elektrotechnik, Deutsch."); return true; }
      if (/woche|ganze|stundenplan$/.test(tl) && !/(heute|morgen|montag|dienstag|mittwoch|donnerstag|freitag)/.test(tl)) {
        extraCard("🏫 Stundenplan", ["mo", "di", "mi", "do", "fr"].filter(k => tt[k]).map(k => `${cap(TAGE[WD_KEYS.indexOf(k)])}: ${tt[k].join(", ")}`));
        assistantSay("Hier ist dein Stundenplan."); return true;
      }
      const d = new Date(); if (/übermorgen/.test(tl)) d.setDate(d.getDate() + 2); else if (/morgen/.test(tl)) d.setDate(d.getDate() + 1);
      const wi = TAGE.findIndex(w => tl.includes(w)); if (wi >= 0) { let add = (wi - d.getDay() + 7) % 7; d.setDate(d.getDate() + add); }
      const k = WD_KEYS[d.getDay()], day = /morgen/.test(tl) && wi < 0 ? "Morgen" : wi >= 0 ? "Am " + cap(TAGE[wi]) : "Heute";
      const ex = dataGet("exams", []).filter(x => x.date === dayKey(d));
      assistantSay(tt[k] ? `${day} hast du ${tt[k].join(", ")}.` + (ex.length ? ` Achtung: ${ex.map(x => x.kind + (x.subject ? " in " + x.subject : "")).join(", ")}!` : "") : `${day} hast du laut Stundenplan keine Schule.`);
      return true;
    }
    return false;
  }

  // ---------- 5) Lernmodus ----------
  let learn = null;   // { topic, q, a, n, right }
  const LEARN_START = /(?:^|[^\wäöüß])(frag\s+mich\s+(.+?\s+)?ab|lernmodus|quiz|prüf\w*\s+mich|lass\s+uns\s+lernen|ich\s+will\s+lernen|übungsfragen)(?![\wäöüß])/i;
  const LEARN_END = /^\W*(stopp?|ende|fertig|genug|aufhören|hör\s+auf|lernmodus\s+(?:beenden|aus|ende)|das\s+reicht|schluss)\W*$/i;
  async function learnNext() {
    const weak = dataGet("learn_weak", []).filter(w => !learn.topicLow || w.topic.toLowerCase().includes(learn.topicLow) || learn.topicLow.includes(w.topic.toLowerCase()));
    const repeat = weak.length && Math.random() < 0.35 ? weak[Math.floor(Math.random() * weak.length)] : null;
    busy = true; refreshUi();
    try {
      let q;
      if (repeat) q = { frage: repeat.q, antwort: repeat.a };
      else q = await llmJson(`Du bist Prüfer für die Ausbildung zum Elektroniker für Automatisierungstechnik (Berufsschule, IHK-Zwischen- und Abschlussprüfung). Thema: ${learn.topic}. Stelle EINE neue, kurze Prüfungsfrage, die man mündlich in ein bis zwei Sätzen beantworten kann (keine Multiple-Choice, keine Rechnung mit vielen Zahlen). Bisherige Fragen, bitte nicht wiederholen: ${learn.asked.slice(-8).join(" | ") || "keine"}. Antworte als JSON mit frage und antwort (die richtige Musterantwort, kurz).`,
        { type: "object", properties: { frage: { type: "string" }, antwort: { type: "string" } }, required: ["frage", "antwort"] });
      busy = false; refreshUi();
      learn.q = q.frage; learn.a = q.antwort; learn.asked.push(q.frage); learn.n++;
      assistantSay((repeat ? "Wiederholung, die hattest du letztes Mal falsch: " : `Frage ${learn.n}: `) + q.frage);
      lastViaVoice = true;
    } catch (e) { busy = false; refreshUi(); learn = null; assistantSay("Für den Lernmodus brauche ich die KI, die ist gerade nicht erreichbar. " + (e.message || "")); }
  }
  async function handleLearn(text) {
    const t = clean(text), tl = t.toLowerCase();
    if (learn) {
      if (LEARN_END.test(tl)) {
        const l = learn; learn = null; lastViaVoice = false;
        const answered = l.n - (l.q ? 1 : 0);
        assistantSay(answered > 0 ? `Lernmodus beendet. Du hattest ${l.right} von ${answered} richtig. ${l.right / answered >= .8 ? "Stark!" : l.right / answered >= .5 ? "Gut, da geht noch was." : "Übung macht den Meister, die falschen frage ich nächstes Mal nochmal ab."}` : "Lernmodus beendet.");
        return true;
      }
      if (!backend) { learn = null; assistantSay("Die KI ist gerade weg, ich beende den Lernmodus."); return true; }
      const dunno = /^(?:weiß\s+(?:ich\s+)?nicht|keine\s+ahnung|k\.?\s*a\.?|überspringen|weiter|nächste)$/i.test(tl);
      busy = true; refreshUi();
      let ev = { richtig: false, erklaerung: "Die richtige Antwort: " + learn.a };
      if (!dunno) {
        try {
          ev = await llmJson(`Prüfungsfrage (Elektroniker für Automatisierungstechnik): "${learn.q}"\nMusterantwort: "${learn.a}"\nAntwort des Azubis (gesprochen, Spracherkennung kann Fehler haben): "${t}"\nBewerte fair: richtig, wenn der Kern stimmt, auch wenn Fachwörter leicht anders sind. Gib eine kurze Rückmeldung für die Sprachausgabe (1 bis 3 Sätze, Du-Form): bei richtig kurz loben und ggf. ergänzen, bei falsch die richtige Antwort einfach erklären. Antworte als JSON mit richtig (boolean) und erklaerung.`,
            { type: "object", properties: { richtig: { type: "boolean" }, erklaerung: { type: "string" } }, required: ["richtig", "erklaerung"] });
        } catch {}
      }
      busy = false; refreshUi();
      const weak = dataGet("learn_weak", []);
      if (ev.richtig) { learn.right++; dataSet("learn_weak", weak.filter(w => w.q !== learn.q)); }
      else if (!weak.some(w => w.q === learn.q)) { weak.push({ q: learn.q, a: learn.a, topic: learn.topic, ts: Date.now() }); dataSet("learn_weak", weak.slice(-60)); }
      assistantSay((ev.richtig ? "✓ Richtig! " : "✗ Nicht ganz. ") + ev.erklaerung);
      const waitThenNext = () => { if (!learn) return; if (speaking) { setTimeout(waitThenNext, 300); return; } learnNext(); };
      setTimeout(waitThenNext, 600);
      return true;
    }
    const m = LEARN_START.exec(tl);
    if (!m) return false;
    if (!backend) { assistantSay("Für den Lernmodus brauche ich die KI. Stell sie links bei KI-Quelle ein."); return true; }
    let topic = (tl.match(/frag\s+mich\s+(?:in\s+|zu\s+|über\s+)?(.+?)\s+ab\b/) || tl.match(/(?:lernmodus|quiz|abfrage|übungsfragen|lernen)\s+(?:zu\s+|in\s+|über\s+|für\s+)?(.+)$/) || [])[1];
    if (!topic || /^(mal|bitte|was|etwas)$/.test(topic)) topic = "gemischte Grundlagen: Elektrotechnik, SPS, Messtechnik, Sicherheit (VDE), Digitaltechnik, Automatisierung";
    learn = { topic, topicLow: topic.toLowerCase(), q: null, a: null, n: 0, right: 0, asked: [] };
    const tName = topic.split(":")[0].trim();
    assistantSay(`Lernmodus: ${tName.length <= 4 ? tName.toUpperCase() : cap(tName)}. Antworte einfach, sag „weiß nicht“ zum Überspringen und „Stopp“ zum Beenden.`);
    const go = () => { if (speaking) { setTimeout(go, 300); return; } learnNext(); };
    setTimeout(go, 500);
    return true;
  }

  // ---------- 1) Morgen-Briefing ----------
  const BRIEF_RE = /^(?:(?:hey\s+|hallo\s+)?jarvis\W*)?(?:guten\s+morgen|moin|morgen|briefing|morgen-?briefing|tagesüberblick|tagesbriefing|was\s+(?:geht|steht)\s+(?:heute\s+)?(?:so\s+)?an|wie\s+sieht\s+mein\s+tag\s+(?:heute\s+)?aus|was\s+gibt'?s\s+neues)\W*(?:jarvis)?\W*$/i;
  async function handleBriefing(text) {
    const t = clean(text).toLowerCase();
    if (!BRIEF_RE.test(t) && !BRIEF_RE.test(text.trim().toLowerCase())) return false;
    busy = true; refreshUi();
    const n = new Date(), parts = [], lines = [];
    const hour = n.getHours();
    parts.push((hour < 11 ? "Guten Morgen" : hour < 18 ? "Hallo" : "Guten Abend") + ", " + anrede() + ". Heute ist " + n.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }) + ".");
    const withTimeout = (p, ms = 6000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
    // Wetter
    try { const w = await withTimeout(weatherFor(null)); if (w) { const a = weatherSentence(w, 0); parts.push(a.s.replace(/^Gerade/, "Es sind gerade")); lines.push(a.card); } } catch {}
    // Termine + Mails (nur wenn Google schon verbunden ist – keine Anmeldung aufdrängen)
    if (gClientId || AND) {
      try {
        await withTimeout(getToken(true), 4000);
        const s0 = new Date(n); s0.setHours(0, 0, 0, 0); const e0 = new Date(s0); e0.setDate(e0.getDate() + 1);
        const ev = await withTimeout(gApi(`https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${s0.toISOString()}&timeMax=${e0.toISOString()}`));
        const items = (ev.items || []).filter(x => !/Tagebuch geschrieben/.test(x.summary || ""));
        if (items.length) {
          parts.push(`Du hast ${items.length === 1 ? "einen Termin" : items.length + " Termine"}: ` + items.slice(0, 4).map(x => (x.start.dateTime ? new Date(x.start.dateTime).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " " : "") + (x.summary || "Termin")).join(", ") + ".");
          items.slice(0, 6).forEach(x => lines.push("📅 " + (x.start.dateTime ? new Date(x.start.dateTime).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " " : "ganztägig ") + (x.summary || "Termin")));
        } else parts.push("Heute stehen keine Termine im Kalender.");
        const ml = await withTimeout(gApi(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent("is:unread in:inbox newer_than:2d")}&maxResults=10`));
        const cnt = (ml.messages || []).length;
        if (cnt) { parts.push(`${cnt >= 10 ? "Mindestens 10" : cnt} neue Mail${cnt > 1 ? "s" : ""}.`); lines.push(`✉ ${cnt} neue Mails`); }
      } catch {}
    }
    // Schule
    const tt = dataGet("timetable", {}), sk = WD_KEYS[n.getDay()];
    if (tt[sk]) { parts.push(`In der Schule hast du heute ${tt[sk].join(", ")}.`); lines.push("🏫 " + tt[sk].join(", ")); }
    const exams = dataGet("exams", []).filter(x => { const d = (new Date(x.date + "T12:00") - new Date().setHours(12, 0, 0, 0)) / 86400000; return d >= 0 && d <= 7; }).sort((a, b) => a.date.localeCompare(b.date));
    for (const x of exams.slice(0, 2)) { const d = Math.round((new Date(x.date + "T12:00") - new Date().setHours(12, 0, 0, 0)) / 86400000); parts.push(`${x.kind}${x.subject ? " in " + x.subject : ""} ${d === 0 ? "ist heute" : d === 1 ? "ist morgen" : "in " + d + " Tagen"}.`); lines.push(`📝 ${x.kind} ${x.subject || ""} – ${d === 0 ? "heute" : d === 1 ? "morgen" : "in " + d + " Tagen"}`); }
    // Geburtstage
    for (const b of birthdaysSoon(1)) { parts.push(`${b.name} hat ${b.inDays === 0 ? "heute" : "morgen"} Geburtstag!`); lines.push(`🎂 ${b.name} – ${b.inDays === 0 ? "heute" : "morgen"}`); }
    // Erinnerungen heute
    try { if (AND && AND.reminderList) { const e0 = new Date(); e0.setHours(23, 59, 59); const rl = JSON.parse(AND.reminderList() || "[]").filter(x => x.at <= e0.getTime()).sort((a, b) => a.at - b.at); if (rl.length) { parts.push("Erinnerungen heute: " + rl.map(x => x.text).join(", ") + "."); rl.forEach(x => lines.push(`⏰ ${new Date(x.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} ${x.text}`)); } } } catch {}
    // To-dos
    const todo = (dataGet("lists", {}).todo || []); if (todo.length) { parts.push(`Auf deiner To-do-Liste ${todo.length === 1 ? "steht ein Punkt" : "stehen " + todo.length + " Punkte"}.`); lines.push("✅ " + todo.slice(0, 5).join(", ")); }
    // Geld
    try {
      if (AND && AND.bankCached) { const d = JSON.parse(AND.bankCached() || "null"); if (d && d.ok) { parts.push(`Auf dem Konto sind ${d.balance < 0 ? "minus " : ""}${eur(d.balance)}.`); lines.push(`🏦 ${d.balance < 0 ? "−" : ""}${eur(d.balance)}`); budgetWarnings(finAnalyze(d)).forEach(x => { parts.push(x); lines.push("⚠ " + x); }); } }
    } catch {}
    const w = wGet(); if (w.last) { lines.push(`◎ Wallet ${eur(w.last.total)}`); }
    busy = false; refreshUi();
    lsSet("zg_brief_day", dayKey(n));
    extraCard((hour < 11 ? "☀️ Morgen-Briefing" : "📋 Tagesüberblick") + " · " + n.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }), lines);
    assistantSay(parts.join(" "));
    return true;
  }

  async function handleExtras(text) {
    if (await handleLearn(text)) return true;           // Lernmodus zuerst (fängt Antworten ab)
    if (await handleBriefing(text)) return true;
    if (handleNav(text)) return true;
    if (handleSchool(text)) return true;
    if (handleReminder(text)) return true;
    if (handleTimer(text)) return true;
    if (handleLists(text)) return true;
    if (handleBudget(text)) return true;
    if (await handlePriceAlert(text)) return true;
    if (await handleWeather(text)) return true;
    if (handleMemory(text)) return true;
    return false;
  }
