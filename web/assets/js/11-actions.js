  async function handleActions(text) {
    if (pending) {
      if (NO.test(text)) { await resolvePending(false, false); return true; }   // „nein“/„bitte nicht“ zuerst prüfen
      if (YES.test(text)) { await resolvePending(true, false); return true; }
      closeCard(pending); pending = null; agentRest = [];
    }
    if (!diaryMode && !learn && handleHelp(text)) return true;
    if (!diaryMode && !learn && lockedBlock(text)) return true;
    if (!diaryMode && !learn && await handleSearch(text)) return true;   // „Was hab ich über … gesagt?“
    if (await handleDiary(text)) return true;
    if (await handleExtras(text)) return true;
    if (await handleFinance(text)) return true;
    if (await handleWallet(text)) return true;
    if (await handlePc(text)) return true;
    if (await handleWhatsApp(text)) return true;
    if (handleAlarm(text)) return true;
    if (handleMedia(text)) return true;
    if (handleCall(text)) return true;
    if (!ACTION_RE.test(text)) return false;
    const bubble = add("msg ai wait", "Schaut nach …");
    busy = true; refreshUi();
    let x = null;
    try { x = await extractAction(text); } catch { x = null; }
    bubble.remove(); busy = false; refreshUi();
    if (!x || !x.aktion || x.aktion === "keine") return false;
    switch (x.aktion) {
      case "termin_erstellen": return proposeEvent(x);
      case "termine_anzeigen": if (!gClientId) return needGoogle(); await showEvents(x); return true;
      case "mails_pruefen": if (!gClientId) return needGoogle(); await checkMails(); return true;
      case "mail_lesen": if (!gClientId) return needGoogle(); await readMail(x); return true;
      case "mail_entwurf": if (!gClientId) return needGoogle(); await draftMail(x); return true;
      case "kontakt_suchen": if (!gClientId) return needGoogle(); await findContact(x); return true;
    }
    return false;
  }

  // Karte mit zwei Knöpfen (Bestätigen / Abbrechen); wird zur offenen Rückfrage
  function makePending(type, title, sub, body, yesText, noText, data) {
    const card = document.createElement("div"); card.className = "card";
    const t = document.createElement("b"); t.textContent = title; card.append(t);
    if (sub) { const s = document.createElement("span"); s.className = "sub"; s.textContent = sub; card.append(s); }
    if (body) { const b = document.createElement("div"); b.className = "body"; b.textContent = body; card.append(b); }
    const row = document.createElement("div"); row.className = "row";
    const yes = document.createElement("button"); yes.type = "button"; yes.className = "btn primary"; yes.textContent = yesText;
    const no = document.createElement("button"); no.type = "button"; no.className = "btn"; no.textContent = noText;
    row.append(yes, no); card.append(row);
    log.append(card); log.scrollTop = log.scrollHeight;
    const p = { type, card, row, ...data };
    yes.onclick = () => { if (pending === p) { hush(); stopListening(true); resolvePending(true, true); } };
    no.onclick = () => { if (pending === p) { hush(); stopListening(true); resolvePending(false, true); } };
    pending = p;
    return p;
  }
  function closeCard(p) { if (p && p.card) p.card.querySelectorAll("button").forEach(b => b.disabled = true); }

  async function resolvePending(ok, byClick) {
    const p = pending; pending = null;
    if (!p) return;
    closeCard(p);
    if (!ok) agentRest = [];   // „nein“ bricht auch die restlichen Befehle ab
    if (p.type === "event") await finishEvent(p, ok, byClick);
    else if (p.type === "draft") await finishDraft(p, ok);
    else if (p.type === "whatsapp") await finishWhatsApp(p, ok);
    else if (p.type === "pc") finishPc(p, ok);
    continueAgent();
  }

  /* ---------- KI-Helfer für freie Sätze ----------
     Wenn kein fester Befehl passt, übersetzt die KI den Satz in einen oder mehrere
     bekannte Befehle („Standard-Sätze“). Die laufen dann durch die normalen Befehle.
     So klappt auch „Kannst du morgen früh um 6 klingeln und Milch auf die Liste setzen?“ */
  const AGENT_HINT = /\b(stell\w*|setz\w*|schreib\w*|schick\w*|spiel\w*|erinner\w*|zeig\w*|trag\w*|merk\w*|ruf\w*|lösch\w*|streich\w*|navigier\w*|bring\w*|weck\w*|mach\w*|leg\w*|pack\w*|notier\w*|klingel\w*|check\w*|prüf\w*|schau\w*|guck\w*|sag mir|hab ich|brauch\w*|kannst du|könntest du|würdest du|und dann|danach|außerdem|wecker|timer|liste|budget|kohle|geld|konto|wetter|regen|jacke|musik|lied|song|termin|tagebuch|abfrag\w*|wallet|kurs|briefing|stundenplan|arbeit|test|schulaufgabe|klausur|pizza|einkauf\w*)\b/i;
  const AGENT_SKIP = /^\s*(was ist|was sind|was bedeutet|wer (ist|war)|warum|wieso|weshalb|wie funktioniert|erklär\w*|erzähl\w*( mir)? (was|etwas|einen)|schreib( mir)? (einen?|ein) (text|gedicht|aufsatz|geschichte|witz|bewerbung|zusammenfassung))\b/i;
  const AGENT_CATALOG = `Wecker/Timer: "Stell den Wecker um 6 Uhr" · "Stell den Wecker morgen um 6:30 nur auf dem Handy" · "Stell einen Timer auf 12 Minuten"
Erinnerung: "Erinner mich morgen um 16 Uhr an die Hausaufgaben" · "Erinner mich in 20 Minuten an die Pizza" · "Welche Erinnerungen habe ich?"
Listen: "Setz Milch und Eier auf die Einkaufsliste" · "Was steht auf der Einkaufsliste?" · "Streich Milch von der Einkaufsliste" · "Setz Mathe-Hausaufgaben auf meine To-dos" · "Mathe ist erledigt"
Kalender: "Trag morgen um 10 Uhr Zahnarzt ein" · "Welche Termine hab ich diese Woche?"
Mails: "Hab ich neue Mails?" · "Lies meine letzte Mail" · "Schreib Papa eine Mail, dass ich später komme"
WhatsApp/Anruf: "Schreib Papa auf WhatsApp hallo" · "Ruf Papa an"
Musik: "Spiel Gzuz" · "Spiel weiter" · "Pause" · "Nächstes Lied" · "Lauter" · "Leiser"
Wetter: "Wie wird das Wetter morgen?" · "Brauch ich heute eine Jacke?" · "Regnet es übermorgen in Würzburg?"
Tag: "Guten Morgen" (Briefing: Wetter, Termine, Mails, Schule, Konto)
Gedächtnis: "Merk dir, mein Ausbilder heißt Herr Müller" · "Was weißt du über mich?" · "Vergiss das mit Herrn Müller"
Schule: "Was hab ich morgen in der Schule?" · "Wann ist die nächste Arbeit?" · "Am 15. Oktober schreiben wir eine Arbeit in SPS" · "Frag mich SPS ab"
Geld: "Wie sieht's aus mit meinen Finanzen?" · "Was sind meine Fixkosten?" · "Zeig mir eine Statistik von meinem Konto" · "Wie steht mein Budget?" · "Setz mein Monatsbudget auf 600 Euro" · "Wie sieht's aus in meiner Phantom Wallet?" · "Sag mir Bescheid, wenn SOL unter 100 Dollar fällt"
Navigation: "Navigier mich nach Hause" · "Wie lange brauche ich nach Schweinfurt?"
Tagebuch: "Tagebuch" · "Lies mir mein Tagebuch von gestern vor"
Suche: "Was hab ich über Lukas gesagt?" · "Wann hab ich über den Führerschein geredet?"
PC: "Mach am PC leiser" · "Öffne Spotify am PC" · "Sperr den PC" · "Fahr den PC in 30 Minuten herunter"`;

  let agentRest = [];      // Befehle, die nach einer Rückfrage (z. B. „Senden?“) noch dran sind
  let agentRunning = false;

  function looksLikeCommand(text) {
    if (text.length > 260 || AGENT_SKIP.test(text)) return false;
    return AGENT_HINT.test(text);
  }

  async function agentRoute(text) {
    const now = new Date();
    const prompt = `Du bist der Befehls-Übersetzer des Sprachassistenten Jarvis. Heute ist ${WD[now.getDay()]}, ${ymd(now)}, ${pad(now.getHours())}:${pad(now.getMinutes())} Uhr.
Jarvis versteht nur diese Standard-Sätze (Beispiele, Namen/Zeiten/Inhalte darfst du anpassen):
${AGENT_CATALOG}

Aufgabe: Will der Nutzer, dass Jarvis etwas TUT oder in seinen Daten NACHSCHAUT, schreib seinen Wunsch als einen oder mehrere Standard-Sätze in der Form oben (höchstens 4, in der richtigen Reihenfolge). Übernimm alle Namen, Zeiten und Inhalte genau. Erfinde nichts dazu.
Ist es nur eine Frage, ein Gespräch, eine Erklärung oder passt kein Standard-Satz, gib eine leere Liste zurück.
Nachricht: "${text.replace(/"/g, "'")}"`;
    const schema = { type: "object", properties: { befehle: { type: "array", items: { type: "string" } } }, required: ["befehle"] };
    const r = await llmJson(prompt, schema);
    const list = (r && Array.isArray(r.befehle) ? r.befehle : []).map(s => String(s || "").trim()).filter(Boolean).slice(0, 4);
    // nicht denselben Satz zurückgeben (sonst Schleife) und nichts Uferloses
    return list.filter(s => s.length < 200 && s.toLowerCase() !== text.trim().toLowerCase());
  }

  function waitIdle(maxMs = 25000) {
    return new Promise(res => {
      const t0 = Date.now();
      const tick = () => (!speaking && !busy) || Date.now() - t0 > maxMs ? res() : setTimeout(tick, 150);
      setTimeout(tick, 200);
    });
  }

  async function runAgentList(list) {
    agentRunning = true;
    let did = 0;
    try {
      while (list.length) {
        const cmd = list.shift();
        if (did) await waitIdle();
        if (await handleActions(cmd)) did++;
        if (pending) { agentRest = list.slice(); break; }   // erst die Rückfrage beantworten lassen
      }
    } finally { agentRunning = false; }
    return did;
  }

  /** true = erledigt; false = normal mit der KI weiterreden */
  async function handleAgent(text) {
    if (agentRunning || !backend || !looksLikeCommand(text)) return false;
    const bubble = add("msg ai wait", "Versteht …");
    busy = true; refreshUi();
    let list = [];
    try { list = await agentRoute(text); } catch { list = []; }
    bubble.remove(); busy = false; refreshUi();
    if (!list.length) return false;
    return (await runAgentList(list)) > 0;
  }

  async function continueAgent() {
    if (!agentRest.length || pending) return;
    const rest = agentRest; agentRest = [];
    await waitIdle();
    await runAgentList(rest);
  }

  /* Sperrbildschirm: Finanzen, Wallet, Tagebuch lesen, Mails, Nachrichten, Anrufe, Suche und „Was weißt du über mich“
     erst nach dem Entsperren (sonst könnte jeder am gesperrten Handy fragen) */
  const PRIVATE_RE = /\b(finanz\w*|konto\w*|kontostand|guthaben|ausgaben|ausgegeben|einnahmen|fixkosten|abos?|budget\w*|sparkasse|statistik\w*|gehalt|lohn|geld|wallet|phantom|krypto\w*|mails?|e-mails?|posteingang|postfach|whatsapp|sms|nachricht\w*|ruf\w*|anruf\w*|telefonnummer|nummer|adresse|termine?|kalender)\b|was\s+weißt\s+du\s+über\s+mich|was\s+(?:hab|habe)\s+ich\s+.*\s(?:gesagt|geredet|erzählt|geschrieben)|\bsuch\w*\s+in\b|\btagebuch\b.*\b(lies|lese|vor|zeig\w*|was)\b|\b(lies|zeig\w*)\b.*\btagebuch\b/i;
  function lockedBlock(text) {
    if (!MINI || !deviceLocked() || !PRIVATE_RE.test(text)) return false;
    assistantSay("Das ist privat. Entsperr zuerst dein Handy, dann sag es nochmal.");
    return true;
  }
