  /* ================= Weitere Dienste =================
     WebUntis (Stundenplan/Ausfälle), Müllkalender (Landkreis Schweinfurt), Tankpreise (Tankerkönig),
     Nachrichten (Tagesschau), Handy (Taschenlampe, Nicht stören, lautlos, Akku), Samsung Health,
     Berichtsheft, Lernplan, Orts-Erinnerungen, DHL-Pakete, Google Aufgaben, SmartThings. */

  /* ---------- Hilfen: Anfragen über die App (kein CORS) ---------- */
  const svWait = {};
  window.__zgNet = { emit(r) { const f = r && svWait[r.id]; if (f) f(r); } };
  function nativeCall(start, ms = 30000) {
    return new Promise(res => {
      const id = "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const t = setTimeout(() => { delete svWait[id]; res({ ok: false, status: 0, msg: "Zeitüberschreitung", error: "Zeitüberschreitung" }); }, ms);
      svWait[id] = r => { clearTimeout(t); delete svWait[id]; res(r); };
      try { start(id); } catch (e) { clearTimeout(t); delete svWait[id]; res({ ok: false, status: 0, msg: e.message, error: e.message }); }
    });
  }
  async function svNet(url, { method = "GET", headers = {}, body = "" } = {}) {
    let r;
    if (AND && AND.http) r = await nativeCall(id => AND.http(id, method, url, JSON.stringify(headers), typeof body === "string" ? body : JSON.stringify(body)));
    else {
      try { const f = await fetchT(url, { method, headers, body: method === "GET" ? undefined : body }, 20000); r = { status: f.status, body: await f.text() }; }
      catch (e) { r = { status: 0, error: e.message }; }
    }
    if (!r.status) throw new Error(r.error || "Keine Verbindung");
    const text = r.body || "";
    return { status: r.status, ok: r.status >= 200 && r.status < 300, text, json() { try { return JSON.parse(text || "null"); } catch { return null; } } };
  }
  const svWait1 = (fn, ms) => new Promise(res => { const b = busyBubble("Schaut nach …"); Promise.resolve(fn()).then(v => { b(); res(v); }, e => { b(); res({ __err: e }); }); });
  const svDays = (a, b) => Math.round((new Date(ymd(b) + "T12:00") - new Date(ymd(a) + "T12:00")) / 864e5);
  const svDayWord = (d, now = new Date()) => { const n = svDays(now, d); return n === 0 ? "Heute" : n === 1 ? "Morgen" : n === 2 ? "Übermorgen" : "Am " + WD[d.getDay()]; };
  const svHome = () => { const me = dataGet("me", {}); return me.city || (dataGet("muell", {}).ort) || ""; };
  // Welcher Tag ist gemeint? (heute/morgen/übermorgen/Wochentag) – ohne Angabe: nach 15 Uhr morgen
  function svDayFrom(tl, fallbackTomorrowAfter = 15) {
    const d = new Date(); d.setHours(12, 0, 0, 0);
    if (/übermorgen/.test(tl)) { d.setDate(d.getDate() + 2); return d; }
    if (/\bmorgen\b/.test(tl) && !/\bheute\s+morgen\b|\bguten\s+morgen\b/.test(tl)) { d.setDate(d.getDate() + 1); return d; }
    if (/\bheute\b/.test(tl)) return d;
    const wi = TAGE.findIndex(w => tl.includes(w));
    if (wi >= 0) { d.setDate(d.getDate() + ((wi - d.getDay() + 7) % 7)); return d; }
    if (new Date().getHours() >= fallbackTomorrowAfter) d.setDate(d.getDate() + 1);
    return d;
  }

  /* ================= 1) WebUntis ================= */
  const untisOn = () => !!(AND && AND.untisReady && AND.untisReady());
  const uNum = d => +ymd(d).replace(/-/g, "");
  const uHM = t => `${Math.floor(t / 100)}:${pad(t % 100)}`;
  const uSubj = l => (l.su && l.su[0] && (l.su[0].longname || l.su[0].name)) || l.lstext || "Stunde";
  const uShort = l => (l.su && l.su[0] && (l.su[0].name || l.su[0].longname)) || l.lstext || "Stunde";
  async function untisGet(from, to) {
    const r = await nativeCall(id => AND.untisRange(id, uNum(from), uNum(to)), 40000);
    if (!r.ok) throw new Error(r.msg || "Untis antwortet nicht");
    return r.lessons || [];
  }
  // Stunden eines Tages, gleiche Fächer hintereinander zusammengefasst
  function untisDay(lessons, d) {
    const key = uNum(d);
    const ls = lessons.filter(l => l.date === key).sort((a, b) => a.startTime - b.startTime || (a.code === "cancelled") - (b.code === "cancelled"));
    const out = [];
    for (const l of ls) {
      const last = out[out.length - 1];
      if (last && uSubj(last) === uSubj(l) && (last.code || "") === (l.code || "") && last.endTime >= l.startTime - 20) { last.endTime = Math.max(last.endTime, l.endTime); continue; }
      out.push({ ...l });
    }
    return out;
  }
  function untisSay(day, word) {
    if (!day.length) return { s: `${word} hast du laut Untis keine Schule.`, lines: [`${word}: keine Schule`], changes: [] };
    const live = day.filter(l => l.code !== "cancelled");
    const changes = day.filter(l => l.code === "cancelled" || l.code === "irregular" || l.substText);
    const lines = day.map(l => `${uHM(l.startTime)}–${uHM(l.endTime)} ${uSubj(l)}${l.ro && l.ro[0] && l.ro[0].name ? " · " + l.ro[0].name : ""}${l.code === "cancelled" ? " ✗ entfällt" : l.code === "irregular" ? " ⚠ Vertretung/Änderung" : ""}${l.substText ? " (" + l.substText + ")" : ""}`);
    if (!live.length) return { s: `${word} fällt die Schule komplett aus!`, lines, changes };
    const subj = [...new Set(live.map(uSubj))];
    let s = `${word} hast du von ${uHM(live[0].startTime)} bis ${uHM(live[live.length - 1].endTime)} Uhr Schule: ${subj.join(", ")}.`;
    if (changes.length) s += " Achtung: " + changes.map(l => `${uSubj(l)} um ${uHM(l.startTime)} ${l.code === "cancelled" ? "fällt aus" : "ist geändert" + (l.substText ? " (" + l.substText + ")" : "")}`).join(", ") + ".";
    return { s, lines, changes };
  }
  const UNTIS_Q = /(stundenplan|vertretung\w*|unterricht|schule|schulfrei|fällt\s+.*aus|fallen\s+.*aus|ausfall|entfällt|stunden?\s+(?:aus|frei)|schluss|aus\s*haben|frei\s*haben|erste\s+stunde|anfang|fängt|beginnt)/;
  async function handleUntis(text) {
    const t = clean(text), tl = t.toLowerCase();
    if (!UNTIS_Q.test(tl)) return false;
    if (/\b(arbeit|klausur|prüfung|schulaufgabe|test|lernplan|berichtsheft)\b/.test(tl)) return false;   // Arbeiten → Schule-Befehle
    if (/[:]|merk\s+dir|^stundenplan\s+(?:am\s+|für\s+)?\w+tag\s+/.test(tl) || /^(?:am|jeden)\s+\w+tag\s+(?:habe?|haben)/.test(tl)) return false;   // Stundenplan von Hand eintragen
    if (/navigier|adresse|wie\s+(?:lange|weit)|fahr/.test(tl)) return false;
    if (!/(was|welche|wann|wie|hab|habe|haben|hast|gibt|fällt|fallen|zeig|ist|sind|muss|vertretungsplan|stundenplan)/.test(tl)) return false;
    if (!untisOn()) return false;   // ohne Untis: alter Stundenplan
    const week = /woche/.test(tl) || (/stundenplan/.test(tl) && !/(heute|morgen|montag|dienstag|mittwoch|donnerstag|freitag)/.test(tl));
    let from = svDayFrom(tl), to = from;
    if (week) {
      from = new Date(); from.setHours(12, 0, 0, 0);
      if (/nächste/.test(tl) || from.getDay() === 6 || from.getDay() === 0) from.setDate(from.getDate() + ((8 - from.getDay()) % 7 || 7));
      else from.setDate(from.getDate() - (from.getDay() - 1));
      to = new Date(from); to.setDate(from.getDate() + 4);
    }
    const r = await svWait1(() => untisGet(from, to));
    if (r && r.__err) { assistantSay("Untis hat gerade nicht geklappt: " + r.__err.message); return true; }
    if (week) {
      const lines = [];
      for (let i = 0; i < 5; i++) { const d = new Date(from); d.setDate(from.getDate() + i); const day = untisDay(r, d); const live = day.filter(l => l.code !== "cancelled");
        lines.push(`${WD[d.getDay()].slice(0, 2)} ${d.getDate()}.${d.getMonth() + 1}.: ` + (live.length ? `${uHM(live[0].startTime)}–${uHM(live[live.length - 1].endTime)} ${[...new Set(live.map(uShort))].join(", ")}` : day.length ? "fällt aus" : "keine Schule") + (day.some(l => l.code === "cancelled" || l.code === "irregular") && live.length ? " ⚠" : "")); }
      extraCard("🏫 Stundenplan (Untis)", lines);
      const ch = r.filter(l => l.code === "cancelled" || l.code === "irregular").length;
      assistantSay(`Hier ist dein Stundenplan für ${/nächste/.test(tl) || from > new Date() ? "nächste" : "diese"} Woche.` + (ch ? ` Es gibt ${ch} Änderung${ch > 1 ? "en" : ""}, die sind mit ⚠ markiert.` : " Keine Ausfälle."));
      return true;
    }
    const word = svDayWord(from), day = untisDay(r, from), a = untisSay(day, word);
    extraCard("🏫 " + word + " · Untis", a.lines);
    if (/(fällt|fallen|ausfall|entfällt|vertretung|änderung|frei)/.test(tl) && day.length) {
      assistantSay(a.changes.length ? a.s.replace(/^.*?Achtung: /, `Ja, ${word.toLowerCase()} gibt es Änderungen: `) : `Nein, ${word.toLowerCase()} fällt nichts aus. ` + a.s);
    } else if (/(schluss|aus\s*haben|wann\s+(?:hab|habe|bin)\s+ich\s+(?:\w+\s+)?(?:fertig|aus|frei))/.test(tl) && day.some(l => l.code !== "cancelled")) {
      const live = day.filter(l => l.code !== "cancelled"); assistantSay(`${word} hast du um ${uHM(live[live.length - 1].endTime)} Uhr Schluss.`);
    } else if (/(anfang|fängt|beginnt|erste\s+stunde|wann\s+muss\s+ich)/.test(tl) && day.some(l => l.code !== "cancelled")) {
      const live = day.filter(l => l.code !== "cancelled"); assistantSay(`${word} fängt die Schule um ${uHM(live[0].startTime)} Uhr an, mit ${uSubj(live[0])}.`);
    } else assistantSay(a.s);
    return true;
  }

  /* ================= 2) Müllkalender (AWIDO, Landkreis Schweinfurt) ================= */
  const AWIDO = "https://awido.cubefour.de/WebServices/Awido.Service.svc/secure";
  const AW_CLIENT = "lra-schweinfurt";
  async function awido(path) {
    const r = await svNet(`${AWIDO}/${path}${path.includes("?") ? "&" : "?"}client=${AW_CLIENT}`);
    if (!r.ok) throw new Error("Müllkalender-Server antwortet nicht (" + r.status + ")");
    const j = r.json(); if (j == null) throw new Error("Müllkalender: unerwartete Antwort");
    return j;
  }
  async function muellFetch(oid) {
    const j = await awido(`getData/${encodeURIComponent(oid)}?fractions=`);
    const names = {}; for (const f of j.fracts || []) names[f.snm] = f.nm;
    const items = [];
    for (const c of j.calendar || []) {
      const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(c.dt || "")); if (!m) continue;
      for (const code of c.fr || []) items.push({ d: `${m[1]}-${m[2]}-${m[3]}`, t: names[code] || code });
    }
    return items.sort((a, b) => a.d.localeCompare(b.d));
  }
  const MUELL_KINDS = [["Restmüll", /rest|schwarz|grau/], ["Bio", /bio|braun/], ["Papier", /papier|blau|pappe|karton/], ["Gelber Sack", /gelb|verpackung|wertstoff/], ["Sperrmüll", /sperr/], ["Problemmüll", /problem|schadstoff|gift/], ["Grüngut", /grüngut|garten|gras|schnitt/]];
  function muellKind(t) { const k = MUELL_KINDS.find(([, re]) => re.test(t.toLowerCase())); return k ? k[0] : null; }
  const MUELL_RE = /(müll|mülltonne|tonne|abfuhr|gelbe[nr]?\s+sack|gelbe\s+säcke|biotonne|bio-?müll|restmüll|papiertonne|papiermüll|sperrmüll|abfall|grüngut)/;
  async function handleMuell(text) {
    const tl = clean(text).toLowerCase();
    if (!MUELL_RE.test(tl) || /(einkaufsliste|to-?do|warenkorb|amazon|kauf|bestell)/.test(tl)) return false;
    if (!/(wann|welche|was|kommt|ist|abgeholt|abholung|raus|stellen|nächste|morgen|heute|abfuhr)/.test(tl)) return false;
    const m = dataGet("muell", null);
    if (!m || !m.items) { assistantSay(`Dein Müllkalender ist noch nicht eingerichtet, ${anrede()}. Menü → Weitere Dienste → Müllkalender: Ort und Straße auswählen, fertig.`); return true; }
    const today = ymd(new Date()), next = m.items.filter(x => x.d >= today);
    if (!next.length) { assistantSay("Im Müllkalender stehen keine weiteren Termine. Öffne einmal Menü → Weitere Dienste → Müllkalender → Aktualisieren."); return true; }
    const when = d => { const n = svDays(new Date(), new Date(d + "T12:00")); return n === 0 ? "heute" : n === 1 ? "morgen" : n === 2 ? "übermorgen" : `am ${WD[new Date(d + "T12:00").getDay()]}, den ${new Date(d + "T12:00").getDate()}.${new Date(d + "T12:00").getMonth() + 1}.`; };
    const kind = muellKind(tl.replace(/müll(?:tonne)?|tonne|abfuhr|abfall/g, " ")) || (/sperr/.test(tl) ? "Sperrmüll" : null);
    if (kind) {
      const x = next.find(i => muellKind(i.t) === kind);
      if (!x) { assistantSay(kind === "Sperrmüll" ? "Sperrmüll steht nicht im Kalender – den musst du beim Landratsamt Schweinfurt anmelden." : `${kind} finde ich im Kalender nicht.`); return true; }
      assistantSay(`${x.t} wird ${when(x.d)} abgeholt.`); return true;
    }
    if (/\bmorgen\b|\bheute\b/.test(tl)) {
      const d = ymd(svDayFrom(tl)); const l = next.filter(i => i.d === d);
      assistantSay(l.length ? `${/\bmorgen\b/.test(tl) ? "Morgen" : "Heute"} wird abgeholt: ${l.map(i => i.t).join(", ")}.` : `${/\bmorgen\b/.test(tl) ? "Morgen" : "Heute"} wird nichts abgeholt.`); return true;
    }
    const days = [...new Set(next.map(i => i.d))].slice(0, 4);
    extraCard("🗑 Müllabfuhr · " + (m.strasse || m.ort || ""), days.map(d => `${new Date(d + "T12:00").toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })}: ${next.filter(i => i.d === d).map(i => i.t).join(", ")}`));
    assistantSay(`Als Nächstes: ${next.filter(i => i.d === days[0]).map(i => i.t).join(" und ")} ${when(days[0])}.` + (days[1] ? ` Danach ${next.filter(i => i.d === days[1]).map(i => i.t).join(" und ")} ${when(days[1])}.` : ""));
    return true;
  }
  // Einmal im Monat im Hintergrund neu laden (neues Jahr, Verschiebungen an Feiertagen)
  async function muellRefresh(force) {
    const m = dataGet("muell", null); if (!m || !m.oid) return;
    if (!force && m.fetched && Date.now() - m.fetched < 20 * 864e5 && (m.items || []).some(x => x.d >= ymd(new Date(Date.now() + 30 * 864e5)))) return;
    try { const items = await muellFetch(m.oid); if (items.length) { m.items = items; m.fetched = Date.now(); dataSet("muell", m); } } catch {}
  }

  /* ================= 3) Tanken (Tankerkönig) ================= */
  const FUEL_T = { diesel: "Diesel", e5: "Super E5", e10: "Super E10" };
  function fuelType(tl) {
    if (/\be\s*10\b|super\s*e\s*10/.test(tl)) return "e10";
    if (/\be\s*5\b|super\s*(?:e\s*5|95|plus)?\b|benzin/.test(tl) && !/diesel/.test(tl)) return "e5";
    if (/diesel/.test(tl)) return "diesel";
    return dataGet("me", {}).fuel || "diesel";
  }
  async function svWhere(askPerm = true) {
    if (AND && AND.locNow) {
      const r = await nativeCall(id => AND.locNow(id), 15000);
      if (r.ok) return { lat: r.lat, lng: r.lng, src: "gps" };
      if (r.msg === "perm" && askPerm && AND.locPerm) { try { AND.locPerm(false); } catch {} }
    }
    const me = dataGet("me", {});
    if (me.homeGeo) return { lat: me.homeGeo.lat, lng: me.homeGeo.lng, src: "home" };
    const city = svHome();
    if (city) { try { const g = me.geo && me.city === city ? me.geo : await geo(city); return { lat: g.lat, lng: g.lon, src: "city", name: g.name || city }; } catch {} }
    return null;
  }
  async function fuelStations(type, where, rad = 10) {
    const key = secGet("zg_tk_key");
    if (!key) throw new Error("need-key");
    const r = await svNet(`https://creativecommons.tankerkoenig.de/json/list.php?lat=${where.lat.toFixed(5)}&lng=${where.lng.toFixed(5)}&rad=${rad}&sort=price&type=${type}&apikey=${encodeURIComponent(key)}`);
    const j = r.json();
    if (!j || !j.ok) throw new Error((j && j.message) || "Tankerkönig antwortet nicht (" + r.status + ")");
    return (j.stations || []).filter(s => s.isOpen !== false && s.price > 0);
  }
  const fuelEur = p => p.toLocaleString("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " €";
  const fuelSay = p => { const e = Math.floor(p), c = Math.round((p - e) * 1000); return `${e} Euro ${Math.floor(c / 10)}${c % 10 === 9 ? " Komma 9" : ""}`; };
  const FUEL_RE = /(tank\w*|sprit|diesel|benzin|super\s*e?\s*(?:5|10|95)|\be\s*10\b|kraftstoff|spritpreis\w*)/;
  async function handleFuel(text) {
    const t = clean(text), tl = t.toLowerCase();
    if (!FUEL_RE.test(tl) || /(tanker|tankwart|tankstelle\s+(?:ist|heißt)|panzer|aquarium|wassertank)/.test(tl) && !/tankstelle/.test(tl)) return false;
    if (/(was\s+(?:ist|sind|bedeutet)|erklär|unterschied|warum)/.test(tl)) return false;
    // Tank-Alarm
    if (/(bescheid|benachrichtig|meld|sag\s+mir|alarm|ping)/.test(tl) && /(unter|billiger\s+als|weniger\s+als)\s*([\d.,]+)/.test(tl)) {
      if (!AND || !AND.fuelWatchSet) { assistantSay("Der Tank-Alarm geht nur in der Android-App."); return true; }
      if (!secGet("zg_tk_key")) { assistantSay("Für Tankpreise brauche ich einmal deinen kostenlosen Tankerkönig-Schlüssel: Menü → Weitere Dienste → Tankerkönig."); return true; }
      let lim = parseFloat(/(?:unter|billiger\s+als|weniger\s+als)\s*([\d.,]+)/.exec(tl)[1].replace(",", "."));
      if (/cent/.test(tl) && lim > 10) lim = lim / 100;
      if (!(lim > 0.5 && lim < 4)) { assistantSay("Den Preis habe ich nicht verstanden. Sag zum Beispiel: Sag mir Bescheid, wenn Diesel unter 1,60 kostet."); return true; }
      const w = await svWhere(); if (!w) { assistantSay("Ich weiß nicht, wo du bist. Erlaube kurz den Standort oder sag: Merk dir, ich wohne in …"); return true; }
      const type = fuelType(tl); AND.fuelWatchSet(lim, type, w.lat, w.lng);
      assistantSay(`Mach ich, ${anrede()}. Wenn ${FUEL_T[type]} im Umkreis von 10 Kilometern unter ${lim.toLocaleString("de-DE", { minimumFractionDigits: 2 })} Euro kostet, bekommst du eine Nachricht. Ich schaue alle zwei Stunden nach.`);
      return true;
    }
    if (/(lösch|stopp|aus)\w*\s+.*tank-?alarm|tank-?alarm\s+(?:aus|löschen|stoppen)/.test(tl)) { if (AND && AND.fuelWatchClear) AND.fuelWatchClear(); assistantSay("Tank-Alarm ist aus."); return true; }
    if (!/(billig|günstig|preis|kost|wo\s+.*tank|wie\s+viel|teuer|stand|tankstelle|tanken|navigier|bring)/.test(tl)) return false;
    // „Mein Auto tankt Diesel“
    const setM = /^(?:merk\s+dir\s*[,:]?\s*)?(?:mein\s+auto|ich)\s+(?:tankt?|fahre?)\s+(diesel|super\s*e?\s*10|e10|super|benzin|e5)/.exec(tl);
    if (setM) { const me = dataGet("me", {}); me.fuel = fuelType(setM[1]); dataSet("me", me); assistantSay(`Gemerkt: Du tankst ${FUEL_T[me.fuel]}.`); return true; }
    const type = fuelType(tl);
    if (!secGet("zg_tk_key")) { assistantSay(`Für Tankpreise brauche ich einmal deinen kostenlosen Tankerkönig-Schlüssel, ${anrede()}. Menü → Weitere Dienste → Tankerkönig, dauert zwei Minuten.`); return true; }
    const res = await svWait1(async () => { const w = await svWhere(); if (!w) throw new Error("Ich weiß nicht, wo du bist. Erlaube den Standort oder sag: Merk dir, ich wohne in …"); return { w, st: await fuelStations(type, w) }; });
    if (res.__err) { assistantSay("Tankpreise gehen gerade nicht: " + res.__err.message); return true; }
    const st = res.st.slice(0, 5);
    if (!st.length) { assistantSay("In 10 Kilometern habe ich gerade keine offene Tankstelle gefunden."); return true; }
    const nm = s => `${(s.brand || s.name || "Tankstelle").trim()} ${s.place ? "in " + s.place : ""}`.trim();
    const maps = s => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`;
    if (/navigier|bring|fahr\s+mich|route/.test(tl)) {
      const s = st[0]; if (AND && AND.maps) AND.maps(`${s.lat},${s.lng}`, "drive", true); else openUrl(maps(s));
      lastViaVoice = false;
      assistantSay(`Ich navigiere dich zu ${nm(s)}, ${FUEL_T[type]} kostet dort ${fuelSay(s.price)}.`); return true;
    }
    linkCard(`⛽ ${FUEL_T[type]} · günstigste in der Nähe`, st.map(s => ({ title: `${fuelEur(s.price)} · ${nm(s)}`, sub: `${(s.street || "").trim()} ${(s.houseNumber || "").trim()} · ${String(s.dist).replace(".", ",")} km`.trim(), url: maps(s), linkText: "Hinfahren" })),
      res.w.src === "gps" ? "Umkreis 10 km um deinen Standort · Daten: Tankerkönig (MTS-K)" : `Umkreis 10 km um ${res.w.name || "dein Zuhause"} (Standort ist aus) · Daten: Tankerkönig`);
    const d = st.length > 1 ? Math.round((st[st.length - 1].price - st[0].price) * 100) : 0;
    assistantSay(`Am günstigsten ist ${nm(st[0])} mit ${fuelSay(st[0].price)} für ${FUEL_T[type]}, ${String(st[0].dist).replace(".", ",")} Kilometer entfernt.` + (d >= 3 ? ` Das sind ${d} Cent pro Liter weniger als bei der teuersten in der Liste.` : ""));
    return true;
  }

  /* ================= 4) Nachrichten (Tagesschau) ================= */
  async function tsNews(n = 5) {
    const r = await svNet("https://www.tagesschau.de/api2u/homepage/");
    const j = r.json(); if (!j) throw new Error("Tagesschau antwortet nicht");
    return (j.news || []).filter(x => x && x.title && (!x.type || x.type === "story")).slice(0, n)
      .map(x => ({ title: x.title, topline: x.topline || "", text: x.firstSentence || "", url: x.shareURL || x.detailsweb || "" }));
  }
  const NEWS_Q = /\b(tagesschau|schlagzeilen|news|weltnachrichten|nachrichtenlage)\b|nachrichten\s+(?:von\s+heute|des\s+tages|aus\s+(?:der\s+welt|deutschland))|^(?:die\s+|aktuelle\s+|lies\s+(?:mir\s+)?(?:die\s+)?)?nachrichten(?:\s+vor)?$|was\s+(?:gibt'?s|gibt\s+es)\s+neues\s+(?:in\s+der\s+welt|in\s+deutschland|auf\s+der\s+welt)|was\s+(?:ist|passiert)\s+(?:heute\s+|gerade\s+)?(?:in\s+der\s+welt|in\s+deutschland)|was\s+ist\s+(?:heute\s+)?(?:so\s+)?los\s+in\s+der\s+welt/i;
  async function handleNews(text) {
    const tl = clean(text).toLowerCase();
    if (!NEWS_Q.test(tl) || /whatsapp|neue\s+nachrichten|nachrichten\s+von\s+(?!heute)|sms|schreib/.test(tl)) return false;
    const r = await svWait1(() => tsNews(5));
    if (r.__err) { assistantSay("Die Nachrichten bekomme ich gerade nicht. " + r.__err.message); return true; }
    if (!r.length) { assistantSay("Gerade finde ich keine Nachrichten."); return true; }
    linkCard("📰 Tagesschau · " + new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }), r.map(x => ({ title: x.title, sub: x.topline, text: x.text, url: x.url, linkText: "Lesen" })));
    assistantSay("Die wichtigsten Nachrichten: " + r.slice(0, 3).map((x, i) => `${i + 1}. ${x.topline ? x.topline + ": " : ""}${x.title}.`).join(" "));
    return true;
  }

  /* ================= 5) Handy: Taschenlampe, Nicht stören, lautlos, Akku ================= */
  function handlePhone(text) {
    const tl = clean(text).toLowerCase();
    const off = /\b(aus|ausschalten|ausmachen|abschalten|beenden|beende|stopp?)\b/.test(tl);
    if (/taschenlampe|lampe\s+(?:am|vom)\s+handy|handy-?lampe|handylicht|licht\s+am\s+handy/.test(tl)) {
      if (!AND || !AND.torch) { assistantSay("Die Taschenlampe geht nur in der Android-App."); return true; }
      const r = AND.torch(!off); lastViaVoice = false;
      assistantSay(r === "ok" ? (off ? "Taschenlampe aus." : "Taschenlampe an.") : r); return true;
    }
    if (/nicht\s+stören|\bdnd\b|ruhemodus/.test(tl) && !/(was|wie)\s+(?:ist|bedeutet)/.test(tl)) {
      if (!AND || !AND.dnd) { assistantSay("Das geht nur in der Android-App."); return true; }
      const r = AND.dnd(!off);
      assistantSay(r === "ok" ? (off ? "„Nicht stören“ ist aus." : "„Nicht stören“ ist an. Wecker und wichtige Anrufe kommen trotzdem durch.") : r === "need" ? "Dafür brauche ich einmal ein Recht: Ich habe dir die Einstellung geöffnet. Such „Zweites Gehirn“, schalte es ein und sag es dann nochmal." : r); return true;
    }
    if (/(handy|telefon|klingelton|klingel)\w*\s.*(lautlos|stumm|vibration|vibrier\w*|laut\b|wieder\s+an)|^(?:mach\s+(?:das\s+|mein\s+)?handy\s+)?(lautlos|stumm)(?:\s+schalten)?$|(lautlos|stumm|vibration)\s+(?:schalten|machen|stellen)|handy\s+auf\s+(lautlos|stumm|vibration|laut)|(?:mach|stell)\w*\s+(?:das\s+|mein\s+)?handy\s+(?:wieder\s+)?laut/.test(tl)) {
      if (!AND || !AND.ringer) { assistantSay("Das geht nur in der Android-App."); return true; }
      const mode = /vibr/.test(tl) ? "vibrate" : /(lautlos|stumm)/.test(tl) && !/(wieder\s+laut|lautlos\s+aus)/.test(tl) ? "silent" : "normal";
      const r = AND.ringer(mode);
      assistantSay(r === "ok" ? ({ silent: "Dein Handy ist jetzt lautlos.", vibrate: "Dein Handy vibriert jetzt nur noch.", normal: "Dein Handy klingelt wieder normal." })[mode] : r === "need" ? "Dafür brauche ich einmal das Recht für „Nicht stören“. Ich habe dir die Einstellung geöffnet: „Zweites Gehirn“ einschalten, dann nochmal sagen." : r); return true;
    }
    if (/\b(akku|akkustand|ladestand|akkuladung)\b|\bbatterie\b(?!n)|wie\s+voll\s+ist\s+(?:mein\s+)?handy/.test(tl) && !/(kauf|bestell|amazon|auto)/.test(tl)) {
      if (!AND || !AND.battery) { assistantSay("Den Akku kann ich nur in der Android-App sehen."); return true; }
      const b = JSON.parse(AND.battery() || "{}");
      if (b.pct == null) { assistantSay("Den Akkustand bekomme ich gerade nicht."); return true; }
      assistantSay(`Dein Akku hat ${b.pct} Prozent${b.charging ? ", er lädt gerade" + (b.fullInMin > 0 ? ` und ist in etwa ${b.fullInMin >= 60 ? Math.floor(b.fullInMin / 60) + " Stunde" + (b.fullInMin >= 120 ? "n" : "") + (b.fullInMin % 60 ? " " + (b.fullInMin % 60) + " Minuten" : "") : b.fullInMin + " Minuten"} voll` : "") : b.pct <= 20 ? ". Zeit zum Laden!" : ""}.`);
      return true;
    }
    return false;
  }

  /* ================= 6) Samsung Health (Health Connect) ================= */
  const healthOn = () => !!(AND && AND.healthState && AND.healthState() === "ok");
  async function healthToday() { const r = await nativeCall(id => AND.healthToday(id), 15000); if (!r.ok) throw new Error(r.msg === "perm" ? "perm" : (r.msg || "Fehler")); return r; }
  const hDur = min => `${Math.floor(min / 60)} Stunden${min % 60 ? " " + (min % 60) + " Minuten" : ""}`;
  async function handleHealth(text) {
    const tl = clean(text).toLowerCase();
    const sleepQ = /(wie\s+(?:lange\s+)?(?:hab|habe)\s+ich\s+(?:heute\s+nacht\s+|letzte\s+nacht\s+)?geschlafen|mein\s+schlaf\b|schlaf\s+(?:letzte|heute)\s+nacht|wie\s+viel\s+schlaf)/.test(tl);
    const stepsQ = /(wie\s+viele?\s+schritte|meine\s+schritte|schritte\s+(?:heute|gemacht|gelaufen)|wie\s+viel\s+bin\s+ich\s+(?:heute\s+)?gelaufen)/.test(tl);
    if (!sleepQ && !stepsQ) return false;
    if (!AND || !AND.healthState) { assistantSay("Gesundheitsdaten gibt es nur in der Android-App."); return true; }
    const st = AND.healthState();
    if (st === "old") { assistantSay("Dafür braucht dein Handy Android 14 oder neuer."); return true; }
    if (st !== "ok") { try { AND.healthConnect(); } catch {} assistantSay("Erlaube mir bitte einmal, Schritte und Schlaf zu lesen – das Fenster ist offen. In Samsung Health muss unter Einstellungen → Health Connect der Abgleich an sein."); return true; }
    const r = await svWait1(healthToday);
    if (r.__err) { assistantSay("Samsung Health antwortet gerade nicht. " + (r.__err.message === "perm" ? "Das Recht fehlt noch." : r.__err.message)); return true; }
    const parts = [];
    if (sleepQ) parts.push(r.sleepMin ? `Du hast ${hDur(r.sleepMin)} geschlafen, von ${new Date(r.sleepStart).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} bis ${new Date(r.sleepEnd).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr.${r.sleepMin < 390 ? " Das ist eher wenig – heute Abend lieber früher ins Bett." : ""}` : "Für letzte Nacht habe ich keine Schlafdaten. Trägst du die Uhr beim Schlafen, und ist in Samsung Health der Abgleich mit Health Connect an?");
    if (stepsQ) parts.push(`Du bist heute ${(r.steps || 0).toLocaleString("de-DE")} Schritte gegangen.${r.steps >= 10000 ? " Stark!" : ""}`);
    assistantSay(parts.join(" "));
    return true;
  }

  /* ================= 7) Berichtsheft ================= */
  let berichtWait = false;
  const kwOf = d => { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return Math.ceil(((x - y0) / 864e5 + 1) / 7); };
  function weekStart(d) { const s = new Date(d); s.setHours(12, 0, 0, 0); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return s; }
  const BERICHT_ADD = /^(?:(?:für\s+(?:mein|das)|fürs|ins|in\s+(?:mein|das))\s+)?berichtsheft\s*(?:eintrag)?\s*[:,-]?\s*(?:heute\s+)?(.{6,})$|^(?:trag\w*|notier\w*|schreib\w*)\s+(?:(?:ins|in\s+(?:mein|das))\s+berichtsheft|(?:fürs|für\s+(?:mein|das))\s+berichtsheft)\s*(?:ein)?\s*[:,-]?\s*(?:dass\s+)?(.{6,})$|^(?:trag\w*|notier\w*|schreib\w*)\s+(?:mir\s+)?(.{6,}?)\s+(?:ins|in\s+(?:mein|das))\s+berichtsheft(?:\s+ein)?$/i;
  async function berichtWeek(text) {
    const tl = text.toLowerCase();
    let s = weekStart(new Date());
    const entries = dataGet("bericht", []);
    const inWeek = st => entries.filter(e => e.date >= ymd(st) && e.date <= ymd(new Date(st.getTime() + 6 * 864e5)));
    if (/letzte|vorige|vergangene/.test(tl) || (!inWeek(s).length && new Date().getDay() <= 2)) s = new Date(s.getTime() - 7 * 864e5);
    const list = inWeek(s).sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
    const kw = kwOf(s), end = new Date(s.getTime() + 4 * 864e5);
    const head = `Ausbildungsnachweis KW ${kw} (${s.getDate()}.${s.getMonth() + 1}. – ${end.getDate()}.${end.getMonth() + 1}.${end.getFullYear()})`;
    if (!list.length) { assistantSay(`Für KW ${kw} habe ich noch keine Einträge. Sag nach der Arbeit einfach: „Berichtsheft: heute habe ich …“`); return true; }
    let full = "";
    if (backend) {
      const b = busyBubble("Schreibt den Wochenbericht …");
      try {
        const r = await llmJson(`Du hilfst einem Azubi (Elektroniker für Automatisierungstechnik) beim Berichtsheft (Ausbildungsnachweis, IHK). Hier sind seine gesprochenen Notizen der Woche (Datum, Ort, Notiz):
${list.map(e => `${WD[new Date(e.date + "T12:00").getDay()]} ${e.date} [${e.kind}]: ${e.text}`).join("\n")}

Schreibe daraus den Wochenbericht: sachlich, in Stichpunkten oder kurzen Sätzen, Fachbegriffe korrekt, keine erfundenen Tätigkeiten (nur was in den Notizen steht, sprachlich sauber). Trenne betriebliche Tätigkeiten und Berufsschule (Fächer/Lernfelder mit Themen). Antworte als JSON: {"betrieb": "Text, Zeilen mit \\n getrennt, pro Tag eine Zeile mit Wochentag", "schule": "Text oder leer", "unterweisungen": "Text oder leer"}`,
          { type: "object", properties: { betrieb: { type: "string" }, schule: { type: "string" }, unterweisungen: { type: "string" } }, required: ["betrieb"] });
        full = `${head}\n\nBetriebliche Tätigkeiten:\n${r.betrieb || "–"}\n\nBerufsschule:\n${r.schule || "–"}` + (r.unterweisungen ? `\n\nUnterweisungen / Schulungen:\n${r.unterweisungen}` : "");
      } catch {}
      b();
    }
    if (!full) {
      const betr = list.filter(e => e.kind !== "Schule"), sch = list.filter(e => e.kind === "Schule");
      full = `${head}\n\nBetriebliche Tätigkeiten:\n${betr.map(e => `${WD[new Date(e.date + "T12:00").getDay()]}: ${e.text}`).join("\n") || "–"}\n\nBerufsschule:\n${sch.map(e => `${WD[new Date(e.date + "T12:00").getDay()]}: ${e.text}`).join("\n") || "–"}`;
    }
    const card = document.createElement("div"); card.className = "card";
    const bt = document.createElement("b"); bt.textContent = "📒 " + head; card.append(bt);
    const body = document.createElement("div"); body.className = "body"; body.style.whiteSpace = "pre-wrap"; body.textContent = full.replace(head + "\n\n", ""); card.append(body);
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn primary"; btn.textContent = "Kopieren";
    btn.onclick = () => { copyText(full); toast("Kopiert – im Berichtsheft einfügen", "📒"); }; card.append(btn);
    log.append(card); log.scrollTop = log.scrollHeight;
    dataSet("bericht_weeks", { ...dataGet("bericht_weeks", {}), [kw + "-" + s.getFullYear()]: full });
    assistantSay(`Dein Wochenbericht für KW ${kw} ist fertig, ${anrede()}. Tipp auf „Kopieren“ und füg ihn in dein Berichtsheft ein. Lies ihn vorher kurz durch.`);
    return true;
  }
  function berichtAdd(text) {
    const d = new Date(), key = ymd(d);
    let kind = /berufsschule|\bschule\b|unterricht|lernfeld|klassenarbeit|\blf\s*\d/.test(text.toLowerCase()) ? "Schule" : "Betrieb";
    const e = dataGet("bericht", []); e.push({ date: key, text: cap(text.trim()), kind, ts: Date.now() }); dataSet("bericht", e.slice(-400));
    const n = e.filter(x => x.date >= ymd(weekStart(d))).length;
    assistantSay(`Notiert fürs Berichtsheft (${kind}).` + (d.getDay() === 5 ? " Heute ist Freitag – sag „Mach meinen Wochenbericht“, dann schreibe ich die ganze Woche zusammen." : n >= 3 ? ` Diese Woche hast du schon ${n} Einträge.` : ""));
  }
  async function handleBericht(text) {
    const t = clean(text), tl = t.toLowerCase();
    if (berichtWait) {
      berichtWait = false;
      if (/^(?:nichts|nix|abbrechen|stopp?|egal|später|nein)$/i.test(tl)) { assistantSay("Okay, dann später."); return true; }
      berichtAdd(t); return true;
    }
    if (!/berichtsheft|wochenbericht|ausbildungsnachweis/.test(tl)) return false;
    if (/(mach|schreib|erstell|erzeug|zeig|fertig)\w*\s+.*(wochenbericht|berichtsheft\s+für\s+(?:diese|die|letzte)\s+woche)|^wochenbericht$|wochenbericht\s+(?:schreiben|machen|bitte)|^berichtsheft\s+(?:für\s+)?(?:diese|die|letzte|vorige)\s+woche$/.test(tl)) return berichtWeek(tl);
    if (/(was\s+steht|zeig|lies)\w*\s.*berichtsheft/.test(tl)) {
      const s = weekStart(new Date()), l = dataGet("bericht", []).filter(e => e.date >= ymd(s));
      if (!l.length) { assistantSay("Diese Woche steht noch nichts im Berichtsheft."); return true; }
      extraCard(`📒 Berichtsheft KW ${kwOf(s)}`, l.map(e => `${WD[new Date(e.date + "T12:00").getDay()].slice(0, 2)} [${e.kind}]: ${e.text}`));
      assistantSay(`Diese Woche hast du ${l.length} Einträge.`); return true;
    }
    if (/^(?:(?:die\s+)?berichtsheft-?\s*erinnerung\s+aus|erinner\w*\s+mich\s+nicht\s+mehr\s+(?:an\s+das|ans)\s+berichtsheft)/.test(tl)) { lsSet("zg_bericht_on", "0"); proactiveSync(); assistantSay("Okay, ich erinnere dich abends nicht mehr ans Berichtsheft."); return true; }
    if (/^(?:(?:die\s+)?berichtsheft-?\s*erinnerung\s+an|erinner\w*\s+mich\s+(?:jeden\s+(?:abend|tag)\s+|wieder\s+)?(?:an\s+das|ans)\s+berichtsheft)/.test(tl)) { lsSet("zg_bericht_on", "1"); proactiveSync(); assistantSay("Okay, ich erinnere dich jeden Werktag um 19 Uhr ans Berichtsheft."); return true; }
    const m = BERICHT_ADD.exec(t);
    const what = m && (m[1] || m[2] || m[3]);
    if (what && !/^(?:für\s+)?(?:diese|letzte)\s+woche$/i.test(what)) { berichtAdd(what); return true; }
    if (/^(?:(?:mein|das)\s+)?berichtsheft$|berichtsheft\s+(?:schreiben|eintragen|machen)$/.test(tl)) { berichtWait = true; assistantSay(`Was hast du heute gemacht, ${anrede()}? Erzähl einfach, ich schreibe mit.`); return true; }
    return false;
  }

  /* ================= 8) Lernplan für Arbeiten ================= */
  const nextExams = () => dataGet("exams", []).filter(x => x.date >= ymd(new Date())).sort((a, b) => a.date.localeCompare(b.date));
  async function studyPlan(ex) {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const until = new Date(ex.date + "T12:00"), left = svDays(today, until);
    const n = Math.max(1, Math.min(left, 7));
    const days = []; for (let i = n; i >= 1; i--) { const d = new Date(until); d.setDate(until.getDate() - i); if (d >= today) days.push(ymd(d)); }
    if (!days.length) days.push(ymd(today));
    let topics = [];
    if (backend) {
      try {
        const r = await llmJson(`Ein Azubi (Elektroniker für Automatisierungstechnik, Berufsschule) schreibt am ${ex.date} eine ${ex.kind || "Arbeit"}${ex.subject ? " in " + ex.subject : ""}${ex.topic ? " über " + ex.topic : ""}. Er hat ${days.length} Lerntage. Erstelle einen realistischen Lernplan: pro Tag EIN konkretes Thema (höchstens 6 Wörter) und eine kurze Übung (höchstens 12 Wörter). Der letzte Tag ist Wiederholung. Antworte als JSON {"tage":[{"thema":"…","uebung":"…"}]} mit genau ${days.length} Einträgen.`,
          { type: "object", properties: { tage: { type: "array", items: { type: "object", properties: { thema: { type: "string" }, uebung: { type: "string" } }, required: ["thema"] } } }, required: ["tage"] });
        topics = (r.tage || []).slice(0, days.length);
      } catch {}
    }
    while (topics.length < days.length) topics.push(topics.length === days.length - 1 ? { thema: "Alles wiederholen", uebung: "Frag mich ab, falsche Fragen nochmal" } : { thema: `Hefteinträge Teil ${topics.length + 1}`, uebung: "Durchlesen, wichtigste Formeln/Begriffe aufschreiben" });
    const plan = {}; days.forEach((d, i) => plan[d] = topics[i].thema + (topics[i].uebung ? " – " + topics[i].uebung : ""));
    return plan;
  }
  async function handleStudy(text) {
    const t = clean(text), tl = t.toLowerCase();
    const want = /lernplan/.test(tl) || /was\s+(?:soll|muss)\s+ich\s+(?:heute\s+)?lernen/.test(tl);
    if (!want) return false;
    const ex = nextExams();
    if (!ex.length) { assistantSay("Ich habe keine anstehende Arbeit eingetragen. Sag zum Beispiel: Am 15. Oktober schreiben wir eine Arbeit in SPS. Dann mache ich dir einen Lernplan."); return true; }
    const subj = ex.find(x => x.subject && tl.includes(x.subject.toLowerCase())) || ex[0];
    if (/was\s+(?:soll|muss)\s+ich\s+(?:heute\s+)?lernen/.test(tl) || /(zeig|wie\s+sieht)\w*\s.*lernplan/.test(tl) && subj.plan) {
      const p = subj.plan && subj.plan[ymd(new Date())];
      if (p) { assistantSay(`Heute für ${subj.kind}${subj.subject ? " in " + subj.subject : ""}: ${p}. Wenn du willst, sag „Frag mich ${subj.subject || ""} ab“.`); return true; }
      if (!subj.plan) { /* weiter: Plan erstellen */ } else { assistantSay("Für heute steht nichts im Lernplan – gönn dir eine Pause."); return true; }
    }
    const b = busyBubble("Erstellt den Lernplan …");
    let plan = null; try { plan = await studyPlan(subj); } catch {}
    b();
    if (!plan) { assistantSay("Den Lernplan konnte ich gerade nicht erstellen."); return true; }
    const all = dataGet("exams", []); const i = all.findIndex(x => x.date === subj.date && x.subject === subj.subject && x.kind === subj.kind);
    if (i >= 0) { all[i] = { ...all[i], plan }; dataSet("exams", all); }
    const left = svDays(new Date(), new Date(subj.date + "T12:00"));
    extraCard(`📚 Lernplan: ${subj.kind}${subj.subject ? " " + subj.subject : ""} (in ${left} Tag${left === 1 ? "" : "en"})`, Object.entries(plan).map(([d, p]) => `${new Date(d + "T12:00").toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })}: ${p}`), "Jeden Morgen um 7:30 kommt das Tagesthema als Hinweis.");
    assistantSay(`Dein Lernplan steht, ${anrede()}. ${Object.keys(plan).length} Tage, jeden Morgen bekommst du das Thema als Hinweis. Heute: ${plan[ymd(new Date())] || Object.values(plan)[0]}.`);
    return true;
  }

  /* ================= 9) Orts-Erinnerungen ================= */
  const PLACE_CATS = [
    [/^(?:dem\s+|einem\s+)?supermarkt$/, '["shop"~"supermarket"]', "Supermarkt"], [/^(?:der\s+|einer\s+)?tankstelle$/, '["amenity"="fuel"]', "Tankstelle"],
    [/^(?:der\s+|einer\s+)?apotheke$/, '["amenity"="pharmacy"]', "Apotheke"], [/^(?:dem\s+|einem\s+)?(?:bäcker|bäckerei)$/, '["shop"="bakery"]', "Bäckerei"],
    [/^(?:dem\s+|einem\s+)?baumarkt$/, '["shop"="doityourself"]', "Baumarkt"], [/^(?:der\s+|einer\s+)?(?:bank|sparkasse)$/, '["amenity"="bank"]', "Bank"],
    [/^(?:der\s+)?post$/, '["amenity"="post_office"]', "Post"], [/^(?:dem\s+|einem\s+)?(?:drogerie|drogeriemarkt)$/, '["shop"="chemist"]', "Drogerie"],
    [/^(?:dem\s+|einem\s+)?(?:getränkemarkt|getränkehandel)$/, '["shop"="beverages"]', "Getränkemarkt"], [/^(?:dem\s+|einem\s+)?(?:elektromarkt|mediamarkt|saturn)$/, '["shop"="electronics"]', "Elektromarkt"],
  ];
  const PLACE_RE = /^(?:erinner\w*\s+mich\s+(?:bitte\s+)?(?:(?:beim|bei\s+(?:der|dem)?|im|in\s+der|am|an\s+der|zum|zur)\s+(.+?)|wenn\s+ich\s+(?:beim|bei\s+(?:der|dem)?|im|in\s+der|am|an\s+der|in)\s+(.+?)\s+bin|wenn\s+ich\s+(zu\s*hause|daheim|hier)\s+bin|(hier|zu\s*hause|daheim))\s*,?\s+(?:an|daran,?\s*(?:dass)?)\s+(.+)|wenn\s+ich\s+(?:beim|bei\s+(?:der|dem)?|im|in\s+der|am|an\s+der|in)\s+(.+?)\s+bin\s*,?\s*erinner\w*\s+mich\s+(?:an|daran,?\s*(?:dass)?)\s+(.+))$/i;
  const savedPlaces = () => dataGet("places", {});
  async function overpass(q, w, rad = 15000) {
    const r = await svNet("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(`[out:json][timeout:20];(${q.replace(/AROUND/g, `(around:${rad},${w.lat},${w.lng})`)});out center 80;`));
    const j = r.json(); if (!j) throw new Error("Kartendienst antwortet nicht");
    const dist = (a, b) => { const R = 6371, dLa = (b.lat - a.lat) * Math.PI / 180, dLo = (b.lng - a.lng) * Math.PI / 180; const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
    return (j.elements || []).map(e => ({ name: (e.tags && (e.tags.name || e.tags.brand)) || "", lat: e.lat != null ? e.lat : e.center && e.center.lat, lng: e.lon != null ? e.lon : e.center && e.center.lon }))
      .filter(e => e.lat != null && e.lng != null).map(e => ({ ...e, km: dist(w, e) })).sort((a, b) => a.km - b.km).slice(0, 20);
  }
  async function placeSpots(place, w) {
    const p = place.toLowerCase().replace(/^(?:der|die|das|dem|den|einem|einer)\s+/, "").trim();
    const sp = savedPlaces();
    const key = /^(zu\s*hause|daheim|zuhause|mein\s+zuhause)$/.test(p) ? "zuhause" : /^(arbeit|betrieb|firma|ausbildung)$/.test(p) ? "arbeit" : /^(schule|berufsschule)$/.test(p) ? "schule" : p;
    if (sp[key]) return { name: sp[key].name || cap(key), spots: [{ name: sp[key].name || cap(key), lat: sp[key].lat, lng: sp[key].lng }] };
    if (key === "hier") return { name: "hier", spots: [{ name: "hier", lat: w.lat, lng: w.lng }] };
    const me = dataGet("me", {});
    const addr = key === "zuhause" ? me.home : key === "arbeit" ? me.work : key === "schule" ? me.school : null;
    if (addr) {
      const r = await svNet("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&q=" + encodeURIComponent(addr));
      const j = r.json(); if (j && j[0]) return { name: cap(key), spots: [{ name: cap(key), lat: +j[0].lat, lng: +j[0].lon }] };
    }
    if (key === "zuhause" || key === "arbeit" || key === "schule") return null;
    const cat = PLACE_CATS.find(([re]) => re.test(p));
    const esc = s => s.replace(/[\\^$.*+?()[\]{}|"]/g, ".");
    const q = cat ? `nwr${cat[1]}AROUND;` : `nwr["name"~"${esc(cap(p))}",i]AROUND;nwr["brand"~"${esc(cap(p))}",i]AROUND;`;
    const spots = await overpass(q, w);
    return spots.length ? { name: cat ? cat[2] : cap(p), spots: spots.map(s => ({ name: s.name || (cat ? cat[2] : cap(p)), lat: s.lat, lng: s.lng })) } : null;
  }
  async function handlePlaces(text) {
    const t = clean(text), tl = t.toLowerCase();
    // „Merk dir, hier ist mein Zuhause / die Arbeit / Oma“
    let m = /^(?:merk\s+dir\s*[,:]?\s*)?(?:hier|das\s+hier|dieser\s+ort)\s+ist\s+(?:mein(?:e)?\s+|die\s+|der\s+|das\s+|bei\s+)?(.{2,30})$/i.exec(t);
    if (m) {
      if (!AND || !AND.locNow) { assistantSay("Orte merken geht nur in der Android-App."); return true; }
      const r = await nativeCall(id => AND.locNow(id), 15000);
      if (!r.ok) { if (r.msg === "perm" && AND.locPerm) AND.locPerm(false); assistantSay(r.msg === "perm" ? "Erlaube mir bitte einmal den Standort, dann sag es nochmal." : "Ich finde gerade deinen Standort nicht."); return true; }
      const raw = m[1].toLowerCase().trim(), key = /^(zuhause|zu\s*hause|daheim|wohnung)$/.test(raw) ? "zuhause" : /^(arbeit|betrieb|firma|ausbildungsbetrieb)$/.test(raw) ? "arbeit" : /^(schule|berufsschule)$/.test(raw) ? "schule" : raw;
      const sp = savedPlaces(); sp[key] = { name: cap(m[1].trim()), lat: r.lat, lng: r.lng }; dataSet("places", sp);
      if (key === "zuhause") { const me = dataGet("me", {}); me.homeGeo = { lat: r.lat, lng: r.lng }; dataSet("me", me); }
      assistantSay(`Gemerkt: Hier ist ${key === "zuhause" ? "dein Zuhause" : cap(m[1].trim())}. Jetzt kannst du sagen: Erinner mich ${key === "zuhause" ? "zu Hause" : key === "arbeit" ? "bei der Arbeit" : "bei " + cap(m[1].trim())} an …`);
      return true;
    }
    if (/(welche|meine|zeig\w*)\s+orts-?erinnerungen/.test(tl)) {
      if (!AND || !AND.placeList) { assistantSay("Orts-Erinnerungen gibt es nur in der Android-App."); return true; }
      const l = JSON.parse(AND.placeList() || "[]");
      if (!l.length) { assistantSay("Du hast keine Orts-Erinnerungen."); return true; }
      extraCard("📍 Orts-Erinnerungen", l.map(x => `${x.place}: ${x.text} (${(x.spots || []).length} Ort${(x.spots || []).length === 1 ? "" : "e"})`));
      assistantSay(`Du hast ${l.length} Orts-Erinnerung${l.length > 1 ? "en" : ""}.`); return true;
    }
    if (/lösch\w*\s+(?:alle\s+)?(?:meine\s+)?orts-?erinnerungen/.test(tl)) { if (AND && AND.placeRemove) AND.placeRemove("*"); assistantSay("Alle Orts-Erinnerungen sind gelöscht."); return true; }
    m = PLACE_RE.exec(t);
    if (!m) return false;
    let place = (m[1] || m[2] || m[3] || m[4] || m[6] || "").trim(), what = (m[5] || m[7] || "").trim().replace(/^(?:an\s+)?/, "");
    if (!place || !what || /^(?:\d|morgen|heute|um\s|abend|mittag|nachmittag|wochenende|januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)/i.test(place)) return false;
    if (!AND || !AND.placeAdd) { assistantSay("Orts-Erinnerungen gehen nur in der Android-App, weil das Handy merken muss, wo du bist."); return true; }
    const st = AND.locState ? AND.locState() : "bg";
    if (st === "none") { AND.locPerm(false); assistantSay("Dafür brauche ich deinen Standort. Erlaube ihn bitte (am besten „Immer“) und sag es dann nochmal."); return true; }
    const res = await svWait1(async () => { const w = await svWhere(false); if (!w) throw new Error("Ich finde deinen Standort gerade nicht."); return placeSpots(place, w); });
    if (res && res.__err) { assistantSay("Das hat nicht geklappt: " + res.__err.message); return true; }
    if (!res) { assistantSay(/zu\s*hause|daheim/.test(place.toLowerCase()) ? "Ich weiß noch nicht, wo dein Zuhause ist. Sag zu Hause einmal: Merk dir, hier ist mein Zuhause." : `„${cap(place)}“ finde ich in deiner Nähe nicht. Wenn du dort bist, sag: Merk dir, hier ist ${cap(place)}.`); return true; }
    const r = AND.placeAdd(cap(what), res.name, JSON.stringify(res.spots), 150);
    if (r === "perm") { AND.locPerm(false); assistantSay("Erlaube bitte den Standort, dann sag es nochmal."); return true; }
    if (r !== "ok" && r !== "need-bg") { assistantSay("Das ging nicht: " + r); return true; }
    const n = res.spots.length;
    assistantSay(`Mach ich, ${anrede()}. Sobald du ${n > 1 ? `an einem von ${n} Orten „${res.name}“ in deiner Nähe` : `bei ${res.name}`} bist, erinnere ich dich an: ${what}.` + (r === "need-bg" ? " Wichtig: Stell den Standort für Jarvis einmal auf „Immer erlauben“, sonst klappt es nur bei offener App. Ich öffne dir die Einstellung." : ""));
    if (r === "need-bg") setTimeout(() => { try { AND.locPerm(true); } catch {} }, 2500);
    return true;
  }

  /* ================= 10) DHL-Pakete ================= */
  const TRACK_RE = /\b(JJD\d{16,22}|JVGL\d{8,22}|00340\d{15,17}|\d{20}|\d{12})\b/g;
  function trackNumbers(text) {
    const out = []; let m; TRACK_RE.lastIndex = 0;
    while ((m = TRACK_RE.exec(text))) {
      const n = m[1];
      if (/^\d{12}$/.test(n) && !/(dhl|sendung|paket|tracking|verfolg)/i.test(text.slice(Math.max(0, m.index - 120), m.index + 40))) continue;
      if (!out.includes(n)) out.push(n);
    }
    return out;
  }
  async function dhlStatus(n) {
    const key = secGet("zg_dhl_key");
    if (!key) return null;
    const r = await svNet(`https://api-eu.dhl.com/track/shipments?trackingNumber=${encodeURIComponent(n)}&language=de&requesterCountryCode=DE`, { headers: { "DHL-API-Key": key, Accept: "application/json" } });
    if (r.status === 404) return { code: "unknown", text: "DHL kennt die Nummer (noch) nicht" };
    if (r.status === 401 || r.status === 403) throw new Error("Der DHL-Schlüssel wird nicht angenommen");
    if (r.status === 429) throw new Error("DHL-Tageslimit erreicht");
    const j = r.json(), s = j && j.shipments && j.shipments[0];
    if (!s) return { code: "unknown", text: "keine Daten" };
    const st = s.status || {};
    return { code: st.statusCode || "", text: st.description || st.status || "", when: st.timestamp || "", eta: s.estimatedTimeOfDelivery || "" };
  }
  async function mailParcels() {
    if (!(gClientId || AND)) return [];
    try { await getToken(true); } catch { return []; }
    const q = encodeURIComponent("newer_than:21d (DHL OR Sendungsnummer OR Sendungsverfolgung OR Paketnummer OR \"wurde versandt\" OR Versandbestätigung)");
    const l = await gApi(`${GM}/messages?q=${q}&maxResults=8`);
    const found = [];
    for (const it of (l.messages || []).slice(0, 8)) {
      try {
        const msg = await gApi(`${GM}/messages/${it.id}?format=full`);
        const txt = (header(msg, "Subject") + "\n" + mailText(msg.payload)).slice(0, 60000);
        for (const n of trackNumbers(txt)) if (!found.some(f => f.n === n)) found.push({ n, from: senderName(header(msg, "From")), subject: header(msg, "Subject"), ts: +msg.internalDate || 0 });
      } catch {}
    }
    return found;
  }
  const PARCEL_RE = /(paket|pakete|sendung|lieferung|dhl|päckchen|sendungsnummer)/;
  async function handleParcels(text) {
    const t = clean(text), tl = t.toLowerCase();
    if (!PARCEL_RE.test(tl) || /(warenkorb|bestell\w*\s+\w+\s+auf|kauf|leg\w*|verkauf)/.test(tl)) return false;
    if (!/(wo|wann|status|kommt|verfolg|stand|unterwegs|angekommen|geliefert|zugestellt|\d{10,})/.test(tl)) return false;
    const direct = trackNumbers(t.replace(/\s+/g, " ").replace(/(\d)\s+(?=\d)/g, "$1"));
    const res = await svWait1(async () => {
      let list = direct.map(n => ({ n, from: "", subject: "" }));
      if (!list.length) { list = await mailParcels(); const known = dataGet("parcels", []); for (const k of known) if (!list.some(x => x.n === k.n) && Date.now() - (k.ts || 0) < 21 * 864e5) list.push(k); }
      list = list.slice(0, 5);
      for (const p of list) { try { p.st = await dhlStatus(p.n); } catch (e) { p.err = e.message; } }
      return list;
    });
    if (res.__err) { assistantSay("Das hat nicht geklappt: " + res.__err.message); return true; }
    if (!res.length) { assistantSay(gClientId || AND ? "In deinen Mails der letzten drei Wochen finde ich keine DHL-Sendungsnummer. Du kannst mir die Nummer auch direkt sagen: Verfolge Sendung …" : "Sag mir die Sendungsnummer: Verfolge Sendung …"); return true; }
    dataSet("parcels", res.map(p => ({ n: p.n, from: p.from, subject: p.subject, ts: p.ts || Date.now() })));
    const stTxt = p => p.err ? p.err : !p.st ? "Status: auf DHL-Seite ansehen" : ({ delivered: "✓ zugestellt", transit: "🚚 unterwegs", "pre-transit": "📦 angekündigt", failure: "⚠ Problem" }[p.st.code] || "") + (p.st.text ? " – " + p.st.text : "") + (p.st.eta && p.st.code !== "delivered" ? ` (erwartet ${new Date(p.st.eta).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })})` : "");
    linkCard("📦 Deine Pakete", res.map(p => ({ title: p.from ? `${p.from}` : "Sendung " + p.n, sub: p.n, text: stTxt(p), url: "https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=" + encodeURIComponent(p.n), linkText: "Bei DHL ansehen" })),
      secGet("zg_dhl_key") ? "" : "Tipp: Mit dem kostenlosen DHL-Schlüssel (Menü → Weitere Dienste) sage ich dir den Status direkt.");
    const open = res.filter(p => p.st && p.st.code !== "delivered");
    const first = res[0];
    if (!secGet("zg_dhl_key")) assistantSay(`Ich habe ${res.length} Sendung${res.length > 1 ? "en" : ""} gefunden${first.from ? ", die neueste von " + first.from : ""}. Tipp auf „Bei DHL ansehen“ für den Status.`);
    else assistantSay(open.length ? `${open.length} Paket${open.length > 1 ? "e sind" : " ist"} unterwegs. ${open[0].from ? open[0].from + ": " : ""}${stTxt(open[0]).replace(/^[^\wÄÖÜäöü]+/, "")}.` : `Alle ${res.length} Pakete sind schon zugestellt.`);
    return true;
  }

  /* ================= 11) Google Aufgaben ================= */
  const TASKS = "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks";
  const gTasksOn = () => lsGet("zg_g_tasks") === "1";
  async function gTasksList() { const r = await gApi(`${TASKS}?showCompleted=false&showHidden=false&maxResults=100`); return (r && r.items || []).filter(x => x.title && x.status !== "completed"); }
  async function gTasksAdd(items) { for (const title of items) { try { await gApi(TASKS, { method: "POST", body: JSON.stringify({ title }) }); } catch {} } }
  async function gTasksDone(what) {
    const l = await gTasksList(); const w = what.toLowerCase();
    for (const x of l) if (x.title.toLowerCase().includes(w) || w.includes(x.title.toLowerCase())) { try { await gApi(`${TASKS}/${x.id}`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) }); } catch {} }
  }
  // Neue Aufgaben aus Google (z. B. am PC oder in Gmail angelegt) in die Jarvis-Liste holen
  async function gTasksPull() {
    if (!gTasksOn()) return;
    try {
      await getToken(true);
      const l = await gTasksList(), lists = dataGet("lists", { einkauf: [], todo: [] });
      const known = new Set((lists.todo || []).map(x => x.toLowerCase())); let add = 0;
      for (const x of l) if (!known.has(x.title.toLowerCase())) { lists.todo = [...(lists.todo || []), x.title]; add++; }
      if (add) dataSet("lists", lists);
    } catch {}
  }

  /* ================= 12) SmartThings ================= */
  const ST_REDIR = "https://loeschd2000-cyber.github.io/2-Gehirn/st.html";
  const ST_SCOPES = "r:devices:* x:devices:* r:locations:*";
  const stGet = () => { try { return JSON.parse(secGet("zg_st") || "null"); } catch { return null; } };
  const stSet = v => secSet("zg_st", v ? JSON.stringify(v) : "");
  const stOn = () => { const s = stGet(); return !!(s && s.refresh); };
  const b64 = s => btoa(unescape(encodeURIComponent(s)));
  async function stTokenReq(params) {
    const s = stGet();
    const r = await svNet("https://auth-global.api.smartthings.com/oauth/token", { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + b64(s.cid + ":" + s.secret), Accept: "application/json" },
      body: Object.entries({ ...params, client_id: s.cid }).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&") });
    const j = r.json();
    if (!r.ok || !j || !j.access_token) throw new Error("SmartThings-Anmeldung fehlgeschlagen" + (j && (j.error_description || j.error) ? ": " + (j.error_description || j.error) : " (" + r.status + ")"));
    stSet({ ...s, access: j.access_token, refresh: j.refresh_token || s.refresh, exp: Date.now() + (j.expires_in || 86400) * 1000 });
  }
  async function stToken() {
    const s = stGet(); if (!s || !s.refresh) throw new Error("SmartThings ist nicht verbunden");
    if (!s.access || Date.now() > (s.exp || 0) - 120000) await stTokenReq({ grant_type: "refresh_token", refresh_token: s.refresh });
    return stGet().access;
  }
  async function stApi(path, method = "GET", body) {
    const tok = await stToken();
    const r = await svNet("https://api.smartthings.com/v1" + path, { method, headers: { Authorization: "Bearer " + tok, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : "" });
    if (r.status === 401) { const s = stGet(); stSet({ ...s, access: "" }); throw new Error("SmartThings-Anmeldung abgelaufen – bitte in den Diensten neu verbinden"); }
    if (!r.ok) { const j = r.json(); throw new Error((j && j.error && j.error.message) || "SmartThings-Fehler " + r.status); }
    return r.json();
  }
  // Schritt 1 (einmal): mit einem 24-Stunden-Schlüssel (PAT) eine eigene Jarvis-App bei SmartThings anlegen
  async function stCreateApp(pat) {
    const name = "jarvis-zg-" + Math.random().toString(36).slice(2, 8);
    const r = await svNet("https://api.smartthings.com/v1/apps?signatureType=ST_PADLOCK&requireConfirmation=true", { method: "POST",
      headers: { Authorization: "Bearer " + pat.trim(), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ appName: name, displayName: "Jarvis", description: "Jarvis Sprachassistent (Zweites Gehirn)", singleInstance: true, appType: "API_ONLY", classifications: ["CONNECTED_SERVICE"],
        oauth: { clientName: "Jarvis", scope: ST_SCOPES.split(" "), redirectUris: [ST_REDIR] } }) });
    const j = r.json();
    if (!r.ok || !j || !j.oauthClientId) throw new Error(r.status === 401 || r.status === 403 ? "Der Schlüssel (PAT) wird nicht angenommen – beim Erstellen alle Häkchen setzen" : "App anlegen ging nicht: " + ((j && j.error && (j.error.message || JSON.stringify(j.error.details || ""))) || r.status));
    stSet({ cid: j.oauthClientId, secret: j.oauthClientSecret, appId: j.app && j.app.appId });
    return stAuthorize();
  }
  function stAuthorize() {
    const s = stGet(); if (!s || !s.cid) throw new Error("Zuerst den Schlüssel eingeben");
    const state = Math.random().toString(36).slice(2, 12); lsSet("zg_st_state", state);
    openUrl(`https://api.smartthings.com/oauth/authorize?client_id=${encodeURIComponent(s.cid)}&response_type=code&redirect_uri=${encodeURIComponent(ST_REDIR)}&scope=${encodeURIComponent(ST_SCOPES)}&state=${state}`);
  }
  window.__zgLink = function (r) {
    if (!r || r.kind !== "smartthings") return false;
    (async () => {
      if (!r.code || r.state !== lsGet("zg_st_state")) { note("SmartThings: Anmeldung abgebrochen oder ungültig."); return; }
      try { await stTokenReq({ grant_type: "authorization_code", code: r.code, redirect_uri: ST_REDIR }); lsSet("zg_st_state", ""); stDevCache = null;
        const d = await stDevices(); toast("SmartThings verbunden", "🏠"); assistantSay(`SmartThings ist verbunden, ${anrede()}. Ich sehe ${d.length} Gerät${d.length === 1 ? "" : "e"}. Sag zum Beispiel: Schalte den Fernseher aus.`); if ($("sheet") && $("sheet").classList.contains("open")) openServices(); }
      catch (e) { note("SmartThings: " + e.message); }
    })();
    return true;
  };
  let stDevCache = null;
  async function stDevices(force) {
    if (stDevCache && !force && Date.now() - stDevCache.ts < 30 * 60000) return stDevCache.list;
    const j = await stApi("/devices"); const items = (j && j.items) || [];
    const rooms = {};
    for (const loc of [...new Set(items.map(d => d.locationId).filter(Boolean))]) { try { const rr = await stApi(`/locations/${loc}/rooms`); for (const x of rr.items || []) rooms[x.roomId] = x.name; } catch {} }
    const list = items.map(d => ({ id: d.deviceId, label: d.label || d.name || "Gerät", room: rooms[d.roomId] || "", caps: [...new Set((d.components || []).flatMap(c => (c.capabilities || []).map(x => x.id)))], cat: ((d.components || [])[0] && (d.components[0].categories || [])[0] && d.components[0].categories[0].name) || "" }));
    stDevCache = { ts: Date.now(), list }; return list;
  }
  const ST_SYN = [[/fernseher|tv|glotze/, /tv|fernseher|television|qled|oled|neo|frame|the\s+frame/i, "Television"], [/licht|lampe|lampen|lichter|beleuchtung/, /licht|lampe|light|bulb|leuchte|strip|led/i, "Light"],
    [/steckdose|stecker/, /steckdose|stecker|plug|outlet|smart\s*plug/i, "SmartPlug"], [/waschmaschine|wäsche/, /wasch|washer/i, "Washer"], [/trockner/, /trockner|dryer/i, "Dryer"],
    [/spülmaschine|geschirrspüler/, /spül|dishwasher/i, "Dishwasher"], [/kühlschrank/, /kühl|fridge|refrigerator/i, "Refrigerator"], [/klima/, /klima|air\s*con|aircon/i, "AirConditioner"], [/staubsauger|saugroboter/, /saug|vacuum|jetbot/i, "RobotCleaner"]];
  function stFind(list, phrase) {
    const p = phrase.toLowerCase().replace(/^(?:den|die|das|dem|mein\w*|alle)\s+/, "").trim();
    const words = p.split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1 && !/^(im|in|der|die|das|den|dem|am|an|vom|von|und)$/.test(w));
    const syn = ST_SYN.find(([re]) => re.test(p));
    const scored = list.map(d => {
      const hay = (d.label + " " + d.room).toLowerCase(); let s = 0;
      for (const w of words) if (hay.includes(w.length > 5 ? w.slice(0, -1) : w)) s += 1;
      if (syn && (syn[1].test(d.label) || d.cat === syn[2])) s += 1.5;
      return { d, s };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    if (!scored.length) return [];
    if (/^alle\s|lichter|lampen/.test(phrase.toLowerCase()) && syn) return scored.filter(x => x.s >= scored[0].s - 1).map(x => x.d);
    return scored.filter(x => x.s === scored[0].s).map(x => x.d);
  }
  const stCmd = (id, capability, command, args) => stApi(`/devices/${id}/commands`, "POST", { commands: [{ component: "main", capability, command, ...(args ? { arguments: args } : {}) }] });
  const ST_DEV_WORDS = /(fernseher|\btv\b|licht|lampe|lampen|lichter|beleuchtung|steckdose|stecker|waschmaschine|trockner|spülmaschine|geschirrspüler|kühlschrank|klima|staubsauger|saugroboter|smartthings)/;
  async function handleSmartThings(text) {
    const t = clean(text), tl = t.toLowerCase();
    if (!ST_DEV_WORDS.test(tl) && !(stOn() && stDevCache && stDevCache.list.some(d => d.label.length > 2 && tl.includes(d.label.toLowerCase())))) return false;
    if (/taschenlampe|handy/.test(tl) || /(was\s+(?:ist|sind|bedeutet)|erklär|wie\s+funktioniert)/.test(tl)) return false;
    const isCmd = /\b(an|aus|ein|einschalten|ausschalten|anmachen|ausmachen|auf\s+\d+|lauter|leiser|fertig|läuft|status|noch|welche\s+geräte|bescheid)\b/.test(tl);
    if (!isCmd) return false;
    if (!stOn()) { assistantSay(`SmartThings ist noch nicht verbunden, ${anrede()}. Menü → Weitere Dienste → SmartThings, das dauert fünf Minuten.`); return true; }
    const res = await svWait1(async () => {
      const list = await stDevices();
      if (/welche\s+geräte|meine\s+geräte/.test(tl)) return { say: `Ich sehe ${list.length} Geräte: ${list.slice(0, 12).map(d => d.label + (d.room ? " (" + d.room + ")" : "")).join(", ")}.`, card: list.map(d => `${d.label}${d.room ? " · " + d.room : ""}`) };
      // Wasch-/Trocken-/Spülmaschine: Status
      if (/(fertig|läuft|wie\s+lange|status|noch|bescheid)/.test(tl) && /(wasch|trockner|spül|geschirr)/.test(tl)) {
        const d = stFind(list, tl.match(/(waschmaschine|trockner|spülmaschine|geschirrspüler)/)[1])[0];
        if (!d) return { say: "Das Gerät finde ich in SmartThings nicht." };
        const s = await stApi(`/devices/${d.id}/status`); const c = (s.components && s.components.main) || {};
        const op = c.washerOperatingState || c.dryerOperatingState || c.dishwasherOperatingState || c["samsungce.washerOperation"] || c["samsungce.dryerOperation"] || c["samsungce.dishwasherOperation"] || {};
        const state = (op.machineState && op.machineState.value) || (op.operatingState && op.operatingState.value) || "";
        const endIso = (op.completionTime && op.completionTime.value) || "";
        const end = endIso ? new Date(endIso) : null;
        const running = /run|running|pause/.test(state);
        if (/bescheid/.test(tl)) {
          if (!running || !end) return { say: `${d.label} läuft gerade nicht.` };
          if (AND && AND.reminderAdd) AND.reminderAdd(String(end.getTime() + 60000), `${d.label} ist fertig`);
          return { say: `Mach ich. ${d.label} ist um ${end.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr fertig, dann bekommst du eine Nachricht.` };
        }
        if (!running) return { say: `${d.label} ist ${state === "stop" || !state ? "aus bzw. fertig" : state}.` };
        const min = end ? Math.max(0, Math.round((end - Date.now()) / 60000)) : null;
        return { say: `${d.label} läuft noch` + (min != null ? ` etwa ${min >= 60 ? Math.floor(min / 60) + " Stunde" + (min >= 120 ? "n" : "") + (min % 60 ? " " + (min % 60) + " Minuten" : "") : min + " Minuten"}, fertig um ${end.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr.` : ".") + " Sag „Sag mir Bescheid, wenn die Waschmaschine fertig ist“, dann melde ich mich." };
      }
      // Dimmen: „Licht im Wohnzimmer auf 40 Prozent“
      let m = /(?:mach\w*|stell\w*|dimm\w*|setz\w*)?\s*(?:das\s+|die\s+|den\s+)?(.+?)\s+auf\s+(\d{1,3})\s*(?:prozent|%)/.exec(tl);
      if (m) {
        const ds = stFind(list, m[1]).filter(d => d.caps.includes("switchLevel"));
        if (!ds.length) return { say: `Ich finde kein dimmbares Gerät „${m[1]}“.` };
        for (const d of ds) await stCmd(d.id, "switchLevel", "setLevel", [Math.max(1, Math.min(100, +m[2]))]);
        return { say: `${ds.map(d => d.label).join(" und ")} auf ${m[2]} Prozent.` };
      }
      // Fernseher lauter/leiser
      if (/(lauter|leiser)/.test(tl) && /(fernseher|\btv\b)/.test(tl)) {
        const d = stFind(list, "fernseher").find(x => x.caps.includes("audioVolume"));
        if (!d) return { say: "Den Fernseher finde ich nicht." };
        const up = /lauter/.test(tl); for (let i = 0; i < 3; i++) await stCmd(d.id, "audioVolume", up ? "volumeUp" : "volumeDown");
        return { say: `Fernseher ${up ? "lauter" : "leiser"}.` };
      }
      // An / Aus
      m = /^(?:schalt\w*|mach\w*|dreh\w*|knips\w*)?\s*(?:mir\s+|bitte\s+|mal\s+)*(.+?)\s+(an|aus|ein|einschalten|ausschalten|anmachen|ausmachen|anschalten|abschalten)$/.exec(tl) || /^(?:schalt\w*|mach\w*)\s+(an|aus|ein)\s+(?:den|die|das)?\s*(.+)$/.exec(tl);
      if (!m) return null;
      const phrase = m[2] && /^(an|aus|ein)$/.test(m[1]) ? m[2] : m[1], onWord = (m[2] && /^(an|aus|ein)$/.test(m[1])) ? m[1] : m[2];
      const on = !/aus|ab/.test(onWord);
      const ds = stFind(list, phrase).filter(d => d.caps.includes("switch"));
      if (!ds.length) return { say: `Ich finde in SmartThings kein Gerät „${phrase.replace(/^(?:den|die|das)\s+/, "")}“. Sag „Welche Geräte hab ich?“, dann siehst du die Namen.` };
      if (ds.length > 3 && !/^alle|lichter|lampen/.test(phrase)) return { say: `Da passen ${ds.length} Geräte. Sag es genauer, zum Beispiel mit dem Raum.` };
      for (const d of ds) await stCmd(d.id, "switch", on ? "on" : "off");
      return { say: `${ds.map(d => d.label).join(", ")} ${on ? "an" : "aus"}.` };
    });
    if (res === null) return false;
    if (res.__err) { assistantSay("SmartThings: " + res.__err.message); return true; }
    if (res.card) extraCard("🏠 SmartThings-Geräte", res.card);
    lastViaVoice = lastViaVoice && !/an\.|aus\./.test(res.say);
    assistantSay(res.say);
    return true;
  }

  /* ================= Briefing-Zusätze ================= */
  briefHooks.push(async (parts, lines, n) => {   // Stundenplan heute (Untis)
    if (!untisOn()) return;
    const d = new Date(n); d.setHours(12, 0, 0, 0);
    const day = untisDay(await untisGet(d, d), d); if (!day.length) return;
    const a = untisSay(day, "Heute"); parts.push(a.s); lines.push("🏫 " + (day.filter(l => l.code !== "cancelled").map(uShort).join(", ") || "fällt aus") + (a.changes.length ? " ⚠" : ""));
  });
  briefHooks.push(async (parts, lines) => {   // Müll heute/morgen
    const m = dataGet("muell", null); if (!m || !m.items) return;
    const t0 = ymd(new Date()), t1 = ymd(new Date(Date.now() + 864e5));
    const a = m.items.filter(x => x.d === t0).map(x => x.t), b = m.items.filter(x => x.d === t1).map(x => x.t);
    if (a.length) { parts.push(`Heute wird ${a.join(" und ")} abgeholt.`); lines.push("🗑 Heute: " + a.join(", ")); }
    if (b.length) { parts.push(`Morgen kommt ${b.join(" und ")}.`); lines.push("🗑 Morgen: " + b.join(", ")); }
  });
  briefHooks.push(async (parts, lines, n) => {   // Schlaf
    if (!healthOn() || n.getHours() >= 12) return;
    const r = await healthToday(); if (r.sleepMin) { parts.push(`Du hast ${hDur(r.sleepMin)} geschlafen.`); lines.push(`😴 ${Math.floor(r.sleepMin / 60)} h ${r.sleepMin % 60} min Schlaf`); }
  });
  briefHooks.push(async (parts, lines) => {   // Lernplan heute
    for (const x of nextExams()) { const p = x.plan && x.plan[ymd(new Date())]; if (p) { parts.push(`Lernplan ${x.subject || x.kind}: ${p}.`); lines.push(`📚 ${x.subject || x.kind}: ${p}`); break; } }
  });
  briefHooks.push(async (parts, lines) => {   // Nachrichten
    const l = await tsNews(3); if (!l.length) return;
    parts.push("Die Schlagzeilen: " + l.map(x => x.title).join(". ") + ".");
    l.forEach(x => lines.push("📰 " + x.title));
  });

  /* ================= Einstellungen: „Weitere Dienste“ ================= */
  function svSection(body, icon, title, stateText, ok) {
    const s = document.createElement("section"); s.className = "svc";
    const h = document.createElement("h3"); h.textContent = icon + " " + title;
    const st = document.createElement("span"); st.className = "svc-st" + (ok ? " ok" : ""); st.textContent = stateText; h.append(st);
    s.append(h); body.append(s); return s;
  }
  function svEl(tag, props = {}, parent) { const e = document.createElement(tag); Object.assign(e, props); if (parent) parent.append(e); return e; }
  function svBtn(parent, text, fn, primary) { const b = svEl("button", { type: "button", className: "btn" + (primary ? " primary" : ""), textContent: text }, parent); b.onclick = async () => { b.disabled = true; try { await fn(b); } catch (e) { toast(e.message || String(e), "⚠", 4000); } b.disabled = false; }; return b; }
  function svInfo(parent, text) { return svEl("p", { className: "svc-hint", textContent: text }, parent); }
  function svLink(parent, text, url) { const a = svEl("a", { href: url, textContent: text, className: "svc-link" }, parent); a.onclick = e => { e.preventDefault(); openUrl(url); }; return a; }

  function openServices() {
    openSheet("Weitere Dienste", body => {
      svInfo(body, "Hier verbindest du Jarvis mit weiteren Apps. Alles ist freiwillig – Schlüssel und Passwörter bleiben verschlüsselt auf deinem Handy.");
      const phone = !!AND;
      // --- WebUntis
      {
        const s = svSection(body, "🏫", "WebUntis (Stundenplan)", untisOn() ? "verbunden" : "aus", untisOn());
        if (!phone || !AND.untisSearch) svInfo(s, "Geht nur in der Android-App.");
        else {
          svInfo(s, "Gleiche Anmeldung wie in der Untis-App. Dann: „Fällt morgen was aus?“, „Was hab ich morgen?“, Änderungen kommen abends als Hinweis.");
          const q = svEl("input", { type: "text", placeholder: "Schule suchen, z. B. Berufsschule Schweinfurt" }, s);
          const res = svEl("div", { className: "svc-list" }, s);
          const form = svEl("div", { className: "svc-form", hidden: true }, s);
          const chosen = svEl("b", {}, form);
          const u = svEl("input", { type: "text", placeholder: "Benutzername (wie in Untis)", autocomplete: "off" }, form);
          const pw = svEl("input", { type: "password", placeholder: "Passwort", autocomplete: "off" }, form);
          let pick = null;
          svBtn(s, "Suchen", async () => {
            res.textContent = "Sucht …";
            const r = await nativeCall(id => AND.untisSearch(id, q.value.trim() || "Schweinfurt"));
            res.textContent = "";
            if (!r.ok) { res.textContent = r.msg || "Nichts gefunden"; return; }
            if (!(r.schools || []).length) { res.textContent = "Keine Schule gefunden."; return; }
            for (const sc of r.schools) { const b = svEl("button", { type: "button", className: "hcmd", textContent: `${sc.name}${sc.address ? " · " + sc.address : ""}` }, res);
              b.onclick = () => { pick = sc; chosen.textContent = sc.name; form.hidden = false; res.textContent = ""; u.focus(); }; }
          });
          svBtn(form, "Speichern & testen", async () => {
            if (!pick || !u.value.trim() || !pw.value) throw new Error("Schule, Benutzer und Passwort ausfüllen");
            secSet("zg_untis", JSON.stringify({ server: pick.server, school: pick.school, user: u.value.trim(), pass: pw.value }));
            const d = new Date(), e = new Date(Date.now() + 6 * 864e5);
            const r = await nativeCall(id => AND.untisRange(id, uNum(d), uNum(e)), 40000);
            if (!r.ok) { secSet("zg_untis", ""); throw new Error(r.msg || "Untis-Anmeldung ging nicht"); }
            toast(`Untis verbunden: ${(r.lessons || []).length} Stunden in den nächsten 7 Tagen`, "🏫", 4000); openServices();
          }, true);
          if (untisOn()) svBtn(s, "Trennen", () => { secSet("zg_untis", ""); toast("Untis getrennt", "🏫"); openServices(); });
        }
      }
      // --- Müllkalender
      {
        const m = dataGet("muell", null);
        const s = svSection(body, "🗑", "Müllkalender (Landkreis Schweinfurt)", m ? (m.strasse || m.ort) : "aus", !!m);
        svInfo(s, "Ort und Straße auswählen. Dann: „Wann kommt die gelbe Tonne?“ und am Abend vorher ein Hinweis zum Rausstellen.");
        const selO = svEl("select", {}, s), selS = svEl("select", { hidden: true }, s), selH = svEl("select", { hidden: true }, s);
        let chosenOid = null, ortName = "", strName = "", hnr = "";
        const fill = (sel, items, ph) => { sel.textContent = ""; svEl("option", { value: "", textContent: ph }, sel); for (const x of items) svEl("option", { value: x.key, textContent: x.value }, sel); sel.hidden = false; };
        svBtn(s, m ? "Anderen Ort wählen" : "Orte laden", async () => {
          const pl = await awido("getPlaces"); fill(selO, (pl || []).sort((a, b) => a.value.localeCompare(b.value)), "Ort wählen …");
        });
        selO.onchange = async () => {
          chosenOid = null; selS.hidden = true; selH.hidden = true; ortName = selO.options[selO.selectedIndex].textContent;
          if (!selO.value) return;
          const st = await awido(`getGroupedStreets/${encodeURIComponent(selO.value)}`);
          if (!st || !st.length || (st.length === 1 && st[0].value === ortName)) { chosenOid = st && st[0] ? st[0].key : selO.value; return; }
          fill(selS, st.sort((a, b) => a.value.localeCompare(b.value)), "Straße wählen …");
        };
        selS.onchange = async () => {
          chosenOid = selS.value || null; strName = selS.options[selS.selectedIndex].textContent; selH.hidden = true;
          if (!selS.value) return;
          try { const hn = await awido(`getStreetAddons/${encodeURIComponent(selS.value)}`); if (hn && hn.length > 1) { fill(selH, hn, "Hausnummer wählen …"); chosenOid = null; } } catch {}
        };
        selH.onchange = () => { chosenOid = selH.value || null; hnr = selH.options[selH.selectedIndex].textContent; };
        svBtn(s, "Speichern", async () => {
          if (!chosenOid) throw new Error("Bitte Ort und Straße (und ggf. Hausnummer) wählen");
          const items = await muellFetch(chosenOid);
          if (!items.length) throw new Error("Für diese Adresse gibt es keine Termine");
          dataSet("muell", { oid: chosenOid, ort: ortName, strasse: strName ? strName + (hnr ? " " + hnr : "") : "", items, fetched: Date.now() });
          const me = dataGet("me", {}); if (!me.city) { me.city = ortName; dataSet("me", me); }
          toast(`Müllkalender gespeichert: ${items.length} Termine`, "🗑", 3500); openServices();
        }, true);
        if (m) { svBtn(s, "Aktualisieren", async () => { await muellRefresh(true); toast("Müllkalender aktualisiert", "🗑"); }); svBtn(s, "Löschen", () => { dataSet("muell", null); openServices(); }); }
      }
      // --- Tankerkönig
      {
        const has = !!secGet("zg_tk_key");
        const s = svSection(body, "⛽", "Tankerkönig (Tankpreise)", has ? "verbunden" : "aus", has);
        svInfo(s, "1. Auf der Seite unten „API-Key“ beantragen (nur E-Mail, kostenlos). 2. Den Schlüssel aus der Mail hier einfügen.");
        svLink(s, "→ Tankerkönig-Schlüssel beantragen", "https://onboarding.tankerkoenig.de/");
        const k = svEl("input", { type: "password", placeholder: "00000000-0000-0000-0000-000000000000", autocomplete: "off" }, s);
        svBtn(s, "Speichern & testen", async () => {
          const v = k.value.trim(); if (!/^[0-9a-f-]{36}$/i.test(v)) throw new Error("Der Schlüssel sieht so aus: 8-4-4-4-12 Zeichen mit Bindestrichen");
          const old = secGet("zg_tk_key"); secSet("zg_tk_key", v);
          try { await fuelStations("diesel", { lat: 50.05, lng: 10.23 }, 5); } catch (e) { secSet("zg_tk_key", old || ""); throw e; }
          toast("Tankerkönig verbunden", "⛽"); openServices();
        }, true);
      }
      // --- DHL
      {
        const has = !!secGet("zg_dhl_key");
        const s = svSection(body, "📦", "DHL (Paketstatus)", has ? "verbunden" : "ohne Live-Status", has);
        svInfo(s, "Ohne Schlüssel findet Jarvis deine Sendungsnummern in Gmail und öffnet die DHL-Seite. Mit Schlüssel sagt er den Status direkt. So geht's: Konto anlegen → „Apps“ → „Create App“ → API „Shipment Tracking – Unified“ auswählen → den „API Key“ hier einfügen.");
        svLink(s, "→ DHL-Entwicklerportal öffnen", "https://developer.dhl.com/");
        const k = svEl("input", { type: "password", placeholder: "API Key", autocomplete: "off" }, s);
        svBtn(s, "Speichern", () => { const v = k.value.trim(); if (v.length < 16) throw new Error("Das ist kein gültiger Schlüssel"); secSet("zg_dhl_key", v); toast("DHL-Schlüssel gespeichert", "📦"); openServices(); }, true);
        if (has) svBtn(s, "Entfernen", () => { secSet("zg_dhl_key", ""); openServices(); });
      }
      // --- SmartThings
      {
        const on = stOn();
        const s = svSection(body, "🏠", "SmartThings (Fernseher, Lampen, Geräte)", on ? "verbunden" : "aus", on);
        if (!phone) svInfo(s, "Einrichten geht nur in der Android-App.");
        else {
          svInfo(s, "1. Link unten öffnen, mit deinem Samsung-Konto anmelden, „Generate new token“, Name „Jarvis“, bei „Authorized Scopes“ ALLE Häkchen setzen, erstellen. 2. Den Schlüssel hier einfügen und „Verbinden“ tippen. 3. Im Browser „Zulassen“ tippen – fertig. Der Schlüssel wird nur einmal gebraucht.");
          svLink(s, "→ SmartThings-Schlüssel erstellen", "https://account.smartthings.com/tokens");
          const k = svEl("input", { type: "password", placeholder: "Schlüssel (PAT) einfügen", autocomplete: "off" }, s);
          svBtn(s, "Verbinden", async () => { const v = k.value.trim(); if (v.length < 20) throw new Error("Bitte den Schlüssel einfügen"); await stCreateApp(v); toast("Jetzt im Browser „Zulassen“ tippen", "🏠", 5000); }, true);
          if (stGet() && stGet().cid && !on) svBtn(s, "Anmeldung nochmal öffnen", () => stAuthorize());
          if (on) { svBtn(s, "Geräte anzeigen", async () => { const d = await stDevices(true); closeSheet(); extraCard("🏠 SmartThings-Geräte", d.map(x => `${x.label}${x.room ? " · " + x.room : ""}`)); }); svBtn(s, "Trennen", () => { stSet(null); stDevCache = null; openServices(); }); }
        }
      }
      // --- Google Aufgaben
      {
        const s = svSection(body, "✅", "Google Aufgaben", gTasksOn() ? "an" : "aus", gTasksOn());
        svInfo(s, "Deine To-do-Liste ist dann auch in Google Tasks (Gmail, Kalender, Handy) – in beide Richtungen. Einmalig in der Google Cloud Console die „Google Tasks API“ aktivieren (Link unten, dein Projekt wählen, „Aktivieren“).");
        svLink(s, "→ Google Tasks API aktivieren", "https://console.cloud.google.com/apis/library/tasks.googleapis.com");
        if (!gTasksOn()) svBtn(s, "Einschalten", async () => { lsSet("zg_g_tasks", "1"); gToken = null; try { await getToken(false); await gTasksList(); } catch (e) { lsSet("zg_g_tasks", "0"); throw new Error("Google Aufgaben: " + e.message); } const l = dataGet("lists", { einkauf: [], todo: [] }); await gTasksAdd(l.todo || []); await gTasksPull(); toast("Google Aufgaben ist verbunden", "✅"); openServices(); }, true);
        else svBtn(s, "Ausschalten", () => { lsSet("zg_g_tasks", "0"); openServices(); });
      }
      // --- Samsung Health
      {
        const st = phone && AND.healthState ? AND.healthState() : "none";
        const s = svSection(body, "❤️", "Samsung Health (Schlaf, Schritte)", st === "ok" ? "verbunden" : "aus", st === "ok");
        if (st === "none") svInfo(s, "Geht nur in der Android-App.");
        else if (st === "old") svInfo(s, "Braucht Android 14 oder neuer.");
        else {
          svInfo(s, "1. In Samsung Health: Einstellungen → Health Connect → Abgleich einschalten (Schritte, Schlaf). 2. Hier „Verbinden“ und beides erlauben. Dann: „Wie hab ich geschlafen?“ und Schlaf im Morgen-Briefing.");
          if (st !== "ok") svBtn(s, "Verbinden", () => { AND.healthConnect(); toast("Schritte und Schlaf erlauben", "❤️"); }, true);
        }
      }
      // --- Standort
      {
        const st = phone && AND.locState ? AND.locState() : "none";
        const s = svSection(body, "📍", "Standort (Tanken, Orts-Erinnerungen)", st === "bg" ? "immer erlaubt" : st === "fg" ? "nur bei offener App" : "aus", st === "bg");
        if (!phone) svInfo(s, "Geht nur in der Android-App.");
        else {
          svInfo(s, "Für „Erinner mich beim Edeka an Milch“ muss der Standort auf „Immer erlauben“ stehen – sonst merkt Jarvis nicht, wenn du ankommst.");
          if (st === "none") svBtn(s, "Standort erlauben", () => AND.locPerm(false), true);
          if (st === "fg") svBtn(s, "„Immer erlauben“ einstellen", () => AND.locPerm(true), true);
        }
      }
      // --- Berichtsheft
      {
        const on = lsGet("zg_bericht_on") !== "0";
        const s = svSection(body, "📒", "Berichtsheft-Erinnerung", on ? "an (19 Uhr)" : "aus", on);
        svInfo(s, "Werktags um 19 Uhr fragt Jarvis, was du gemacht hast (nur wenn noch nichts eingetragen ist). Freitags erinnert er an den Wochenbericht.");
        svBtn(s, on ? "Ausschalten" : "Einschalten", () => { lsSet("zg_bericht_on", on ? "0" : "1"); proactiveSync(); openServices(); });
      }
    });
  }
  if ($("cSvc")) $("cSvc").onclick = openServices;
  // Beim Start: Müllkalender auffrischen, neue Google-Aufgaben holen
  setTimeout(() => { if (!MINI) { muellRefresh(false); gTasksPull(); } }, 9000);

  /* ================= Verteiler ================= */
  async function handleServices(text) {
    if (await handleBericht(text)) return true;
    if (await handlePlaces(text)) return true;
    if (/\berinner\w*\s+mich\b|\bweck\w*\s+mich\b/i.test(text)) return false;   // normale Erinnerungen/Wecker
    if (await handleStudy(text)) return true;
    if (await handleUntis(text)) return true;
    if (await handleMuell(text)) return true;
    if (await handleFuel(text)) return true;
    if (await handleNews(text)) return true;
    if (handlePhone(text)) return true;
    if (await handleHealth(text)) return true;
    if (await handleParcels(text)) return true;
    if (await handleSmartThings(text)) return true;
    return false;
  }
