  async function handleActions(text) {
    if (pending) {
      if (YES.test(text)) { await resolvePending(true, false); return true; }
      if (NO.test(text)) { await resolvePending(false, false); return true; }
      closeCard(pending); pending = null;
    }
    if (await handleDiary(text)) return true;
    if (await handleExtras(text)) return true;
    if (await handleFinance(text)) return true;
    if (await handleWallet(text)) return true;
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
    if (p.type === "event") return finishEvent(p, ok, byClick);
    if (p.type === "draft") return finishDraft(p, ok);
    if (p.type === "whatsapp") return finishWhatsApp(p, ok);
  }
