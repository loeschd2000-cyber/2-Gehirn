  /* ================= Prüfungs-Trainer AP1/AP2 (Elektroniker/in für Automatisierungstechnik) =================
     480 geprüfte Fragen in 16 Themen (assets/data/pruefung.js, wird erst bei Bedarf geladen).
     Karteikarten mit Wiederholsystem (Leitner), Probeprüfung mit IHK-Note, Abfrage per Sprache – alles offline. */

  let ptLoading = null;
  function ptLoad() {
    if (window.PRUEFUNG) return Promise.resolve(window.PRUEFUNG);
    if (ptLoading) return ptLoading;
    ptLoading = new Promise((res, rej) => {
      const me = [...document.scripts].find(s => /10-exam\.js/.test(s.src));
      const v = me && /[?&]v=([^&]+)/.exec(me.src);
      const s = document.createElement("script");
      s.src = "assets/data/pruefung.js" + (v ? "?v=" + v[1] : "");
      s.onload = () => window.PRUEFUNG ? res(window.PRUEFUNG) : rej(new Error("Fragen fehlen"));
      s.onerror = () => { ptLoading = null; rej(new Error("Die Prüfungsfragen konnten nicht geladen werden (Internet?)")); };
      document.head.append(s);
    });
    return ptLoading;
  }
  const ptTopics = () => window.PRUEFUNG || [];
  const ptAll = () => ptTopics().flatMap(t => t.questions.map(q => ({ ...q, topic: t.topic, ttitle: t.title, ticon: t.icon })));
  const ptById = id => ptAll().find(q => q.id === id);

  /* ---------- Lernstand (Leitner-Kästen 1–6) ---------- */
  const PT_DAYS = [0, 0, 1, 3, 7, 16, 35];   // Kasten → Tage bis zur nächsten Wiederholung
  let ptProgCache = null, ptSaveTimer = null;
  const ptProg = () => ptProgCache || (ptProgCache = dataGet("pt_prog", {}));
  function ptSaveSoon() { clearTimeout(ptSaveTimer); ptSaveTimer = setTimeout(() => { dataSet("pt_prog", ptProgCache); proactiveSync(); }, 1200); }
  const ptToday = () => ymd(new Date());
  const ptAddDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
  function ptRecord(id, ok) {
    const p = ptProg(), x = p[id] || { b: 0, r: 0, w: 0 };
    if (ok) { x.b = Math.min(6, (x.b || 0) + 1); x.r = (x.r || 0) + 1; }
    else { x.b = 1; x.w = (x.w || 0) + 1; }
    x.d = ptAddDays(PT_DAYS[x.b]); x.l = Date.now();
    p[id] = x; ptSaveSoon();
  }
  const ptDue = (qs, until = ptToday()) => qs.filter(q => { const x = ptProg()[q.id]; return x && x.d <= until && x.b < 7; });
  const ptNew = qs => qs.filter(q => !ptProg()[q.id]);
  const ptWeak = qs => qs.filter(q => { const x = ptProg()[q.id]; return x && x.w > 0 && x.b <= 2; });
  const ptMastered = qs => qs.filter(q => { const x = ptProg()[q.id]; return x && x.b >= 4; });
  function ptDueCount(until) { const p = ptProg(), t = until || ptToday(); let n = 0; for (const k in p) if (p[k].d <= t) n++; return n; }
  const ptShuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /* ---------- Antworten bewerten ---------- */
  const ptNorm = s => String(s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z0-9,.\- ]/g, " ");
  function ptNum(s) {
    const t = String(s || "").replace(/−/g, "-").replace(/\s/g, "");
    const m = /-?\d+(?:[.,]\d+)*/.exec(t); if (!m) return NaN;
    let x = m[0];
    if (/,\d+$/.test(x) || (x.includes(",") && x.includes("."))) x = x.replace(/\./g, "").replace(",", ".");   // 1.234,5 → 1234.5
    else if (/^\-?\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, "");                                        // 1.000 → 1000
    return parseFloat(x);
  }
  function ptCheck(q, ans) {
    if (q.type === "mc") return +ans === q.answer;
    if (q.type === "calc") { const x = ptNum(ans); if (!isFinite(x)) return false; const tol = Math.max(Math.abs(q.value) * (q.tolerance || 0.02), 1e-9); return Math.abs(x - q.value) <= tol + 1e-9; }
    const a = ptNorm(ans), kw = (q.keywords || []).map(ptNorm).filter(Boolean);
    if (!kw.length) return a.length > 3;
    const hit = kw.filter(k => a.includes(k.trim())).length;
    return hit >= Math.ceil(kw.length / 2);
  }
  // gesprochene Antwort auf eine mc-Frage: „B“, „Antwort C“, „die zweite“ oder der Text einer Antwort
  function ptVoiceChoice(q, text) {
    const t = ptNorm(text).trim();
    const map = { a: 0, ah: 0, aa: 0, erste: 0, eins: 0, b: 1, be: 1, bee: 1, zweite: 1, zwei: 1, c: 2, ce: 2, zeh: 2, tse: 2, see: 2, dritte: 2, drei: 2, d: 3, de: 3, dee: 3, vierte: 3, vier: 3 };
    const m = /^(?:antwort\s+|die\s+|der\s+|ich\s+(?:sage|nehme|glaube)\s+)?(a|ah|aa|b|be|bee|c|ce|zeh|tse|see|d|de|dee|erste|zweite|dritte|vierte|eins|zwei|drei|vier)\b/.exec(t);
    if (m) return map[m[1]];
    let best = -1, bs = 0;
    q.options.forEach((o, i) => { const w = ptNorm(o).split(/\s+/).filter(x => x.length > 2); const s = w.filter(x => t.includes(x)).length / (w.length || 1); if (s > bs) { bs = s; best = i; } });
    return bs >= 0.5 ? best : -1;
  }
  const PT_LETTER = ["A", "B", "C", "D"];
  // IHK-Notenschlüssel (100-Punkte-Skala)
  const ptNote = pct => pct >= 92 ? [1, "sehr gut"] : pct >= 81 ? [2, "gut"] : pct >= 67 ? [3, "befriedigend"] : pct >= 50 ? [4, "ausreichend"] : pct >= 30 ? [5, "mangelhaft"] : [6, "ungenügend"];

  /* ---------- Oberfläche ---------- */
  const ptEl = (tag, cls, text, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.append(e); return e; };
  const ptBody = () => $("sheet") && $("sheet").querySelector(".sheet-body");
  let ptSession = null;   // { mode: "learn"|"exam", queue, i, results, start, title, timer }

  async function ptOpen(view) {
    try { await ptLoad(); } catch (e) { toast(e.message, "⚠", 4000); return; }
    openSheet("🎓 Prüfungs-Trainer", body => view ? view(body) : ptHome(body));
  }
  function ptHome(body) {
    body = body || ptBody(); if (!body) return;
    body.textContent = ""; ptStopTimer(); ptSession = null;
    const all = ptAll(), due = ptDue(all), neu = ptNew(all), mastered = ptMastered(all), seen = all.length - neu.length;
    const st = ptEl("div", "pt-stats", null, body);
    for (const [n, l] of [[due.length, "fällig"], [seen, "gelernt"], [mastered.length, "sitzt"], [all.length, "Fragen"]]) { const c = ptEl("div", "pt-stat", null, st); ptEl("b", null, String(n), c); ptEl("span", null, l, c); }
    const row = ptEl("div", "pt-actions", null, body);
    const go = (t, cls, fn) => { const b = ptEl("button", "btn " + cls, t, row); b.type = "button"; b.onclick = fn; return b; };
    go(due.length ? `▶ Heute lernen (${Math.min(due.length, 20)} fällig + neue)` : "▶ Neue Karten lernen", "primary", () => ptStartLearn(null));
    go("📝 Probeprüfung AP1", "", () => ptStartExam("AP1"));
    go("📝 Probeprüfung AP2", "", () => ptStartExam("AP2"));
    const weak = ptWeak(all); if (weak.length) go(`💪 Schwächen üben (${weak.length})`, "", () => ptStartLearn(null, ptShuffle(weak).slice(0, 20), "Schwächen"));
    ptEl("h3", "pt-h", "Themen", body);
    const grid = ptEl("div", "pt-grid", null, body);
    for (const t of ptTopics()) {
      const qs = all.filter(q => q.topic === t.topic), m = ptMastered(qs).length, s = qs.length - ptNew(qs).length, d = ptDue(qs).length;
      const b = ptEl("button", "pt-topic", null, grid); b.type = "button";
      ptEl("span", "pt-ti", t.icon || "📘", b); ptEl("b", null, t.title, b);
      ptEl("small", null, `${s}/${qs.length} gelernt${d ? " · " + d + " fällig" : ""}`, b);
      const bar = ptEl("span", "pt-bar", null, b); const f = ptEl("i", null, null, bar); f.style.width = Math.round(m / qs.length * 100) + "%";
      b.onclick = () => ptStartLearn(t.topic);
    }
    const hist = dataGet("pt_exams", []);
    if (hist.length) {
      ptEl("h3", "pt-h", "Letzte Probeprüfungen", body);
      for (const h of hist.slice(-5).reverse()) ptEl("div", "pt-hist", `${new Date(h.ts).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} · ${h.part} · ${h.pct} % · Note ${h.note} (${h.word})`, body);
    }
    ptEl("p", "sheet-intro", "Tipp: Sag „Frag mich SPS ab“ oder „Prüfungsfragen zu Schutzmaßnahmen“ – dann fragt Jarvis dich per Sprache ab. Alle Fragen funktionieren auch ohne Internet.", body);
  }

  function ptStartLearn(topic, list, label) {
    const all = ptAll().filter(q => !topic || q.topic === topic);
    let queue = list;
    if (!queue) { const due = ptShuffle(ptDue(all)).slice(0, 20), neu = ptNew(all).slice(0, Math.max(5, 25 - due.length)); queue = [...due, ...neu]; if (!queue.length) queue = ptShuffle(all).slice(0, 15); }
    const t = topic && ptTopics().find(x => x.topic === topic);
    ptSession = { mode: "learn", queue, i: 0, results: [], start: Date.now(), title: label || (t ? t.icon + " " + t.title : "Heute lernen") };
    ptShow();
  }
  function ptStartExam(part) {
    const pool = ptAll().filter(q => (q.part || "").includes(part) || q.part === "AP1+AP2");
    // aus jedem Thema etwas, zusammen 30 Fragen
    const byTopic = {}; for (const q of ptShuffle(pool)) (byTopic[q.topic] = byTopic[q.topic] || []).push(q);
    const queue = []; let k = 0; const keys = ptShuffle(Object.keys(byTopic));
    while (queue.length < 30 && keys.some(t => byTopic[t].length)) { const t = keys[k++ % keys.length]; if (byTopic[t].length) queue.push(byTopic[t].pop()); }
    ptSession = { mode: "exam", part, queue, i: 0, results: [], start: Date.now(), title: "📝 Probeprüfung " + part, limit: 45 * 60000 };
    ptShow();
    ptSession.timer = setInterval(() => { const el = $("ptClock"); if (!ptSession || ptSession.mode !== "exam") return ptStopTimer(); const left = ptSession.limit - (Date.now() - ptSession.start);
      if (el) el.textContent = `⏱ ${Math.max(0, Math.floor(left / 60000))}:${pad(Math.max(0, Math.floor(left / 1000) % 60))}`; if (left <= 0) { ptStopTimer(); ptFinish(true); } }, 1000);
  }
  function ptStopTimer() { if (ptSession && ptSession.timer) { clearInterval(ptSession.timer); ptSession.timer = null; } }

  function ptShow() {
    const body = ptBody(); if (!body || !ptSession) return;
    const s = ptSession; if (s.i >= s.queue.length) return ptFinish(false);
    const q = s.queue[s.i]; body.textContent = ""; body.scrollTop = 0;
    const head = ptEl("div", "pt-top", null, body);
    const back = ptEl("button", "btn", "‹ Übersicht", head); back.type = "button"; back.onclick = () => { if (s.mode === "exam" && !confirmExit()) return; ptHome(); };
    ptEl("span", "pt-prog", `${s.title} · ${s.i + 1}/${s.queue.length}`, head);
    if (s.mode === "exam") ptEl("span", "pt-clock", "⏱", head).id = "ptClock";
    const card = ptEl("div", "pt-card", null, body);
    ptEl("small", "pt-meta", `${q.ticon || ""} ${q.ttitle} · ${q.part || ""} · ${"★".repeat(q.level || 1)}`, card);
    ptEl("p", "pt-qtext", q.q, card);
    const fb = ptEl("div", "pt-fb", null, body); fb.hidden = true;
    const next = ptEl("button", "btn primary wide", s.i + 1 < s.queue.length ? "Weiter ›" : "Auswerten", body); next.type = "button"; next.hidden = true;
    next.onclick = () => { s.i++; ptShow(); };
    const answered = (ok, given, selfGrade) => {
      s.results.push({ id: q.id, ok, given });
      if (s.mode === "learn") { ptRecord(q.id, ok); ptFeedback(fb, q, ok, selfGrade); fb.hidden = false; next.hidden = false; next.focus(); }
      else { s.i++; ptShow(); }
    };
    if (q.type === "mc") {
      const opts = ptEl("div", "pt-opts", null, card);
      q.options.forEach((o, i) => {
        const b = ptEl("button", "pt-opt", null, opts); b.type = "button";
        ptEl("b", null, PT_LETTER[i], b); ptEl("span", null, o, b);
        b.onclick = () => {
          if (opts.dataset.done) return; opts.dataset.done = "1";
          const ok = i === q.answer;
          if (s.mode === "learn") { b.classList.add(ok ? "right" : "wrong"); opts.children[q.answer].classList.add("right"); }
          answered(ok, PT_LETTER[i]);
        };
      });
    } else {
      const f = ptEl("form", "pt-in", null, card);
      const inp = ptEl("input", null, null, f); inp.type = "text"; inp.autocomplete = "off";
      inp.placeholder = q.type === "calc" ? "Ergebnis (Zahl" + (q.unit ? ", in " + q.unit : "") + ")" : "Deine Antwort in 1–2 Sätzen";
      if (q.type === "calc") inp.inputMode = "decimal";
      const sb = ptEl("button", "btn primary", "Prüfen", f); sb.type = "submit";
      f.onsubmit = e => { e.preventDefault(); if (f.dataset.done) return; f.dataset.done = "1"; inp.disabled = true; sb.disabled = true; answered(ptCheck(q, inp.value), inp.value, q.type === "open"); };
      setTimeout(() => inp.focus(), 60);
    }
  }
  function confirmExit() { return !ptSession || ptSession.results.length === 0 || window.confirm("Probeprüfung wirklich abbrechen?"); }
  function ptFeedback(fb, q, ok, selfGrade) {
    fb.textContent = ""; fb.className = "pt-fb " + (ok ? "ok" : "bad");
    ptEl("b", null, ok ? "✓ Richtig!" : "✗ Nicht ganz.", fb);
    if (q.type === "mc" && !ok) ptEl("p", null, `Richtig ist ${PT_LETTER[q.answer]}: ${q.options[q.answer]}`, fb);
    if (q.type === "calc") ptEl("p", null, `Lösung: ${q.answer}`, fb);
    if (q.type === "open") ptEl("p", null, "Musterantwort: " + q.answer, fb);
    if (q.explain) ptEl("p", "pt-ex", q.explain, fb);
    if (selfGrade) {   // freie Antworten: man kann sich selbst korrigieren
      const b = ptEl("button", "btn", ok ? "Eigentlich falsch" : "Ich hatte es sinngemäß richtig", fb); b.type = "button";
      b.onclick = () => { const r = ptSession.results[ptSession.results.length - 1]; r.ok = !r.ok; ptRecord(q.id, r.ok); b.remove(); ptFeedback(fb, q, r.ok, false); };
    }
  }
  function ptFinish(timeUp) {
    ptStopTimer();
    const body = ptBody(), s = ptSession; if (!body || !s) return;
    body.textContent = "";
    const n = s.results.length, right = s.results.filter(r => r.ok).length;
    if (s.mode === "exam") {
      const total = s.queue.length, pct = Math.round(right / total * 100), [note, word] = ptNote(pct);
      // in der Prüfung erst jetzt den Lernstand aktualisieren
      for (const r of s.results) ptRecord(r.id, r.ok);
      const h = dataGet("pt_exams", []); h.push({ ts: Date.now(), part: s.part, pct, note, word, min: Math.round((Date.now() - s.start) / 60000) }); dataSet("pt_exams", h.slice(-30));
      const c = ptEl("div", "pt-result", null, body);
      ptEl("b", "pt-big", `Note ${note}`, c); ptEl("span", null, `${word} · ${right} von ${total} richtig (${pct} %)${timeUp ? " · Zeit abgelaufen" : ""}`, c);
      const wrong = s.queue.filter(q => !s.results.some(r => r.id === q.id && r.ok));
      if (wrong.length) {
        ptEl("h3", "pt-h", "Das solltest du wiederholen", body);
        for (const q of wrong) { const d = ptEl("div", "pt-review", null, body); ptEl("b", null, `${q.ticon || ""} ${q.q}`, d);
          ptEl("p", null, "Lösung: " + (q.type === "mc" ? `${PT_LETTER[q.answer]}: ${q.options[q.answer]}` : q.answer), d); if (q.explain) ptEl("p", "pt-ex", q.explain, d); }
      }
      if (!MINI) setTimeout(() => assistantSay(`Probeprüfung ${s.part} fertig: ${pct} Prozent, das ist Note ${note}, ${word}.${pct >= 67 ? " Stark, weiter so!" : pct >= 50 ? " Bestanden – die falschen Fragen kommen jetzt öfter dran." : " Noch nicht bestanden. Ich lege dir die falschen Fragen in die Wiederholung."}`), 200);
    } else {
      const c = ptEl("div", "pt-result", null, body);
      ptEl("b", "pt-big", `${right}/${n}`, c); ptEl("span", null, `richtig · ${Math.round((Date.now() - s.start) / 60000)} Minuten · morgen fällig: ${ptDueCount(ptAddDays(1))}`, c);
    }
    const b = ptEl("button", "btn primary wide", "Zur Übersicht", body); b.type = "button"; b.onclick = () => ptHome();
    ptSession = null;
  }

  /* ---------- Per Sprache abfragen („Frag mich SPS ab“) ---------- */
  const PT_SYN = [["sps", /\bsps\b|steuerung|speicherprogramm|kop|fup|grafcet/], ["et-grundlagen", /elektrotechnik|ohm|grundlagen/], ["wechselstrom", /wechselstrom|drehstrom|blindleistung|kompensation/],
    ["schutz", /schutz(?:maßnahmen|massnahmen)?\b|vde|netzsystem|rcd|fi-?schalter/], ["pruefen", /prüf(?:en|ung\s+elektrischer)|mess(?:en|technik)|dguv|0701/], ["elektronik", /elektronik|diode|transistor|opv|halbleiter/],
    ["digital", /digital|zahlensystem|binär|hex|logik/], ["regelung", /regel(?:ung|ungstechnik|kreis)|pid|regler/], ["antriebe", /antrieb|motor|motoren|frequenzumrichter|asynchron/],
    ["sensorik", /sensor|sensorik|aktor|aktorik|4-?20/], ["pneumatik", /pneumatik|hydraulik|ventil|zylinder/], ["netzwerk", /netzwerk|bus|profinet|profibus|subnetz|ip-?adress/],
    ["maschinensicherheit", /maschinensicherheit|sicherheit(?:stechnik)?|not-?halt|performance\s+level|maschinenrichtlinie/], ["it", /\bit\b|it-?sicherheit|computer|datensicherung|datenschutz/],
    ["wiso", /wiso|wirtschaft|sozialkunde|ausbildungsrecht|tarif|betriebsrat/], ["planung", /planung|dokumentation|schaltplan|qualität|kennzeichnung/]];
  const ptTopicOf = t => { const hit = PT_SYN.find(([, re]) => re.test(t)); return hit ? hit[0] : null; };
  let ptVoice = null;   // { queue, i, right, topicTitle }
  function ptVoiceAsk() {
    const q = ptVoice.queue[ptVoice.i]; if (!q) return ptVoiceEnd();
    let s = `Frage ${ptVoice.i + 1}: ${q.q}`;
    if (q.type === "mc") s += " " + q.options.map((o, i) => `${PT_LETTER[i]}: ${o}.`).join(" ");
    if (q.type === "calc") s += " Sag mir das Ergebnis" + (q.unit ? " in " + q.unit : "") + ".";
    lastViaVoice = true;
    assistantSay(s);
  }
  function ptVoiceEnd() {
    const v = ptVoice; ptVoice = null; lastViaVoice = false;
    const n = v.i; if (!n) { assistantSay("Abfrage beendet."); return; }
    assistantSay(`Abfrage beendet: ${v.right} von ${n} richtig. ${v.right / n >= 0.8 ? "Sehr stark!" : v.right / n >= 0.5 ? "Gut, die falschen kommen bald nochmal dran." : "Die falschen übe ich die nächsten Tage mit dir."}`);
  }
  async function ptVoiceStart(tl, raw, force) {
    const topic = ptTopicOf(raw || tl);
    const want = topic || force || /(prüfungs?-?fragen|prüfungs-?trainer|prüfungstraining|karteikarten|abschlussprüfung|zwischenprüfung|\bap\s*[12]\b|ihk)/.test(tl);
    if (!want) return false;
    try { await ptLoad(); } catch (e) { return false; }
    const all = ptAll().filter(q => !topic || q.topic === topic);
    const due = ptShuffle(ptDue(all)), neu = ptShuffle(ptNew(all));
    const queue = [...due, ...neu, ...ptShuffle(all)].filter((q, i, a) => a.findIndex(x => x.id === q.id) === i).slice(0, 40);
    const t = topic && ptTopics().find(x => x.topic === topic);
    ptVoice = { queue, i: 0, right: 0, topicTitle: t ? t.title : "gemischte Prüfungsfragen" };
    assistantSay(`Prüfungs-Abfrage: ${ptVoice.topicTitle}. Bei Auswahlfragen sag einfach A, B, C oder D. „Weiß nicht“ überspringt, „Stopp“ beendet.`);
    const go = () => { if (speaking) { setTimeout(go, 300); return; } ptVoiceAsk(); };
    setTimeout(go, 400);
    return true;
  }
  async function ptVoiceAnswer(text) {
    if (!ptVoice) return false;
    const t = clean(text), tl = t.toLowerCase(), q = ptVoice.queue[ptVoice.i];
    if (LEARN_END.test(tl)) { ptVoiceEnd(); return true; }
    if (/^(?:wiederhol\w*|nochmal|noch\s*mal|was\s+war\s+die\s+frage)\W*$/.test(tl)) { ptVoiceAsk(); return true; }
    let ok = false, dunno = /^(?:weiß\s+(?:ich\s+)?nicht|keine\s+ahnung|überspringen|weiter|nächste)\W*$/.test(tl);
    if (!dunno) {
      if (q.type === "mc") { const c = ptVoiceChoice(q, t); if (c < 0) { assistantSay("Sag bitte A, B, C oder D – oder „weiß nicht“."); lastViaVoice = true; return true; } ok = c === q.answer; }
      else ok = ptCheck(q, t);
    }
    ptRecord(q.id, ok); if (ok) ptVoice.right++;
    const sol = q.type === "mc" ? `${PT_LETTER[q.answer]}, ${q.options[q.answer]}` : q.answer;
    ptVoice.i++;
    assistantSay((ok ? "✓ Richtig! " : `✗ ${dunno ? "Kein Problem." : "Leider falsch."} Richtig ist: ${sol}. `) + (q.explain ? q.explain.split(/(?<=[.!?])\s/)[0] : ""));
    const go = () => { if (!ptVoice) return; if (speaking) { setTimeout(go, 300); return; } if (ptVoice.i >= ptVoice.queue.length) ptVoiceEnd(); else ptVoiceAsk(); };
    setTimeout(go, 600);
    return true;
  }

  /* ---------- Befehle ---------- */
  async function handleExam(text) {
    const tl = clean(text).toLowerCase();
    if (/^(?:öffne\s+(?:den\s+)?|zeig\w*\s+(?:mir\s+)?(?:den\s+)?)?(?:prüfungs-?trainer|prüfungstraining|karteikarten)$|^(?:starte?\s+(?:eine\s+)?)?probeprüfung(?:\s+(?:ap\s*)?([12]))?$|^(?:ich\s+will\s+)?(?:für\s+die\s+(?:abschluss|zwischen)?prüfung\s+)?lernen$/.test(tl)) {
      if (MINI) { assistantSay("Öffne die App, dann starte ich den Prüfungs-Trainer. Oder sag: Frag mich SPS ab."); return true; }
      const m = /probeprüfung(?:\s+(?:ap\s*)?([12]))?/.exec(tl);
      if (m) { await ptOpen(() => ptStartExam("AP" + (m[1] || "1"))); assistantSay(`Probeprüfung AP${m[1] || "1"}: 30 Fragen, 45 Minuten. Viel Erfolg, ${anrede()}!`); return true; }
      await ptOpen(); const d = ptDueCount(); assistantSay(d ? `Du hast ${d} Karteikarten fällig. Tipp auf „Heute lernen“.` : "Hier ist dein Prüfungs-Trainer. Such dir ein Thema aus."); return true;
    }
    if (/(wie\s+(?:gut\s+)?bin\s+ich\s+(?:auf\s+die\s+prüfung\s+)?vorbereitet|mein\s+lernstand|lernfortschritt|wie\s+viele\s+karteikarten)/.test(tl)) {
      try { await ptLoad(); } catch { return false; }
      const all = ptAll(), seen = all.length - ptNew(all).length, m = ptMastered(all).length, h = dataGet("pt_exams", []).slice(-1)[0];
      assistantSay(`Du hast ${seen} von ${all.length} Prüfungsfragen schon geübt, ${m} sitzen richtig gut. Heute fällig: ${ptDueCount()}.` + (h ? ` Deine letzte Probeprüfung ${h.part}: ${h.pct} Prozent, Note ${h.note}.` : " Mach doch mal eine Probeprüfung."));
      return true;
    }
    if (/prüfungs-?fragen\s+(?:zu|über|aus)\s+(.+)|^(?:frag|prüf)\w*\s+mich\s+(?:prüfungs-?fragen|für\s+die\s+(?:abschluss|zwischen)?prüfung)/.test(tl)) return ptVoiceStart(tl, tl);
    return false;
  }
  if ($("cExam")) $("cExam").onclick = () => ptOpen();
