  /* ---------- WhatsApp (nur Android-App): „Schreib Papa auf WhatsApp hallo“ ---------- */
  const WA = "whats\\s?app";
  const WA_RES = [
    // schreib Papa auf WhatsApp (,:) hallo / dass ich später komme
    new RegExp("^(?:schreib|schreibe|schick|schicke|sende|send|sag|sage|frag|frage)\\s+(?:mal\\s+)?(?:an\\s+)?(.+?)\\s+(?:auf|per|über|bei|in|via|mit)\\s+" + WA + "\\s*[,:]?\\s*(.+)$", "i"),
    // schreib auf WhatsApp an Papa: hallo
    new RegExp("^(?:schreib|schreibe|schick|schicke|sende|send)\\s+(?:auf|per|über|via|mit)\\s+" + WA + "\\s+(?:an\\s+)?(.+?)\\s*(?:[,:]|\\s(?=dass\\b|ob\\b))\\s*(.+)$", "i"),
    // WhatsApp an Papa: hallo
    new RegExp("^" + WA + "(?:\\s*nachricht)?\\s+an\\s+(.+?)\\s*(?:[,:]|\\s(?=dass\\b|ob\\b))\\s*(.+)$", "i"),
    // schreib Papa eine (WhatsApp-)Nachricht: hallo
    new RegExp("^(?:schreib|schreibe|schick|schicke|sende)\\s+(?:an\\s+)?(.+?)\\s+(?:eine?\\s+)?(?:" + WA + "[\\s-]*)?(?:nachricht|message)\\s*[,:]?\\s*(.+)$", "i"),
  ];
  function waParse(text) {
    if (/\b(e-?mail|mail|sms)\b/i.test(text)) return null;   // Mails/SMS sind kein WhatsApp
    const t = text.trim().replace(/^(?:hey\s+|hallo\s+|ok\s+)?jarvis[,\s]+/i, "").replace(/^(?:bitte|kannst\s+du(?:\s+bitte)?)\s+/i, "").replace(/\s+bitte$/i, "").trim();
    for (const re of WA_RES) {
      const m = re.exec(t);
      if (m) {
        const who = m[1].replace(/^(?:meine[nmrs]?|mein|den|die|der|dem)\s+/i, "").trim();
        const msg = m[2].replace(/^(?:folgendes|das)\s*[,:]\s*/i, "").replace(/[.]+$/, "").trim();
        if (who && msg && who.split(/\s+/).length <= 4 && !/^(?:per|als|über)\s/i.test(msg)) return { who, msg };
      }
    }
    return null;
  }
  /** „dass ich später komme“ -> „Ich komme später.“ (mit KI, sonst einfach) */
  async function waMessage(who, raw) {
    const simple = s => { s = s.replace(/^(?:dass|das)\s+/i, "").trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
    if (!/^(?:dass|das|ob|wann|wo|wie|was|warum|wieso|er\s+soll|sie\s+soll)\b/i.test(raw) && !/\b(?:ich|mir|mich|mein)\b.*\b(?:soll|sollst)\b/i.test(raw)) return simple(raw);
    try {
      const r = await llmJson(`Damian will ${who} per WhatsApp schreiben. Er hat gesagt: "${raw}". Formuliere daraus die kurze Nachricht, genau so wie Damian sie selbst schreiben würde (Ich-Form, direkt an ${who}, locker, keine Anrede-Floskeln, keine Unterschrift, keine Anführungszeichen). Antworte als JSON mit nachricht.`,
        { type: "object", properties: { nachricht: { type: "string" } }, required: ["nachricht"] });
      if (r && r.nachricht && r.nachricht.length < 500) return r.nachricht.trim();
    } catch {}
    return simple(raw);
  }
  window.__zgWa = {
    emit(r) {
      if (r.ok && r.msg === "gesendet") { assistantSay("Gesendet.", true); return; }
      if (r.ok && r.msg === "manuell") {
        if (lsGet("zg_wa_tip") !== "1") { lsSet("zg_wa_tip", "1"); note("Tipp: Damit Jarvis selbst auf Senden drückt, schalte in den App-Einstellungen „WhatsApp automatisch senden“ ein."); }
        return;
      }
      note("WhatsApp: " + (r.msg || "hat nicht geklappt"));
    },
  };
  async function handleWhatsApp(text) {
    const x = waParse(text);
    if (!x) return false;
    if (!AND) { assistantSay("WhatsApp-Nachrichten gehen nur in der Android-App auf deinem Handy."); return true; }
    if (typeof AND.whatsappSend !== "function") { assistantSay("Dafür brauchst du die neueste Version der App."); return true; }
    if (!AND.whatsappReady()) { assistantSay("WhatsApp ist auf diesem Handy nicht installiert."); return true; }
    if (!AND.phoneReady()) { AND.requestPhone(); assistantSay("Ich brauche einmal die Erlaubnis für deine Kontakte. Erlaube sie bitte und sag es dann nochmal."); return true; }
    let list = [];
    try { list = JSON.parse(AND.findContacts(x.who)); } catch {}
    if (!list.length) { assistantSay(`Ich finde „${x.who}“ nicht in deinen Kontakten.`); return true; }
    const q = norm(x.who);
    const names = [...new Set(list.map(c => c.name))];
    const name = names.find(n => norm(n) === q) || (names.length === 1 ? names[0] : null) || names.find(n => norm(n).startsWith(q + " ") || norm(n).split(" ").includes(q));
    if (!name) { assistantSay(`Ich habe mehrere gefunden: ${names.slice(0, 3).join(", ")}. Sag bitte den genauen Namen.`); return true; }
    const nums = list.filter(c => c.name === name);
    const pick = nums.find(c => c.mobile) || nums.find(c => c.primary) || nums[0];
    busy = true; refreshUi();
    const msg = await waMessage(name, x.msg);
    busy = false; refreshUi();
    makePending("whatsapp", "WhatsApp an " + name, pick.number, msg, "Senden", "Abbrechen", { number: pick.number, text: msg, name });
    assistantSay(`WhatsApp an ${name}: ${msg}. Soll ich das senden?`);
    return true;
  }
  function finishWhatsApp(p, ok) {
    if (!ok) { assistantSay("Okay, nicht gesendet."); return; }
    lastViaVoice = false;
    musicHold = Date.now() + 16000;          // kleinen Kreis offen lassen, bis gesendet ist
    AND.whatsappSend(p.number, p.text);
    if (!AND.whatsappAuto()) assistantSay("WhatsApp ist offen. Tippe noch auf Senden.", true);
  }

  /* ---------- Anrufen (nur Android-App): „Ruf Papa an“ ---------- */
  const CALL_RES = [
    /^(?:bitte\s+)?(?:ruf|rufe)\s+(?:bitte\s+)?(?:mal\s+)?(.+?)\s+an\b/i,
    /^(?:bitte\s+)?(?:kannst du\s+)?(.+?)\s+anrufen\b/i,
    /^(?:bitte\s+)?(?:anruf|anrufen)\s+(?:bei\s+)?(.+?)$/i,
    /^(?:bitte\s+)?telefonier\w*\s+(?:mit\s+)?(.+?)$/i,
  ];
  function callTarget(text) {
    const t = text.trim().replace(/^(?:(?:hey\s+)?jarvis[,\s]+)/i, "").replace(/[.!?]+$/, "");
    if (/\b(termin|erinner\w*|trag\w*|kalender|wecker)\b/i.test(t)) return null;   // „Termin: Zahnarzt anrufen“ ist kein Anruf
    for (const re of CALL_RES) {
      const m = re.exec(t);
      if (m) {
        const who = m[1].replace(/^(?:ich\s+(?:will|möchte|muss)\s+)/i, "").replace(/^(?:meine[nmrs]?|mein|den|die|der|dem)\s+/i, "").trim();
        if (/\d|:/.test(who) || who.split(/\s+/).length > 3) return null;
        return who;
      }
    }
    return null;
  }
  const norm = x => (x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  function handleCall(text) {
    const who = callTarget(text);
    if (!who) return false;
    if (!AND) { assistantSay("Anrufen geht nur in der Android-App auf deinem Handy."); return true; }
    if (!AND.phoneReady()) {
      AND.requestPhone();
      assistantSay("Ich brauche einmal die Erlaubnis für Kontakte und Telefon. Erlaube sie bitte und sag es dann nochmal.");
      return true;
    }
    let list = [];
    try { list = JSON.parse(AND.findContacts(who)); } catch {}
    if (!list.length) { assistantSay(`Ich finde „${who}“ nicht in deinen Kontakten.`); return true; }
    const q = norm(who);
    const names = [...new Set(list.map(c => c.name))];
    let name = names.find(n => norm(n) === q) || (names.length === 1 ? names[0] : null) || names.find(n => norm(n).startsWith(q + " ") || norm(n).split(" ").includes(q));
    if (!name) { assistantSay(`Ich habe mehrere gefunden: ${names.slice(0, 3).join(", ")}. Sag bitte den genauen Namen, zum Beispiel: ruf ${names[0]} an.`); return true; }
    const nums = list.filter(c => c.name === name);
    const pick = nums.find(c => c.primary) || nums.find(c => c.mobile) || nums[0];
    lastViaVoice = false;                 // nach dem Anruf nicht weiter zuhören
    assistantSay(`Ich rufe ${name} an.`);
    const ep = ttsEpoch;                  // Tipp auf den Kreis (Stopp) bricht den Anruf ab
    const waitThenCall = () => {
      if (ep !== ttsEpoch) return;
      if (speaking) { setTimeout(waitThenCall, 200); return; }
      setTimeout(() => { if (ep === ttsEpoch) AND.call(pick.number); }, 1500);
    };
    setTimeout(waitThenCall, 400);
    return true;
  }


  /* ---------- Musik (nur Android-App): „Spiel Gzuz auf Spotify“, „nächstes Lied“ ---------- */
  // Welche Sätze was bedeuten (bewusst großzügig, weil man es unterschiedlich sagt)
  const M_ART = "(?:die|den|das|meine?n?)\\s+";
  const M_OBJ = "(?:musik|lied|song|titel|track|playlist|spotify|podcast)";
  const MEDIA_CMDS = [
    ["next", "Nächstes Lied.", [
      /^(?:(?:spiel|spiele|mach|nimm|geh\s+zu|gehe\s+zu|zum)\s+)?(?:das\s+|dem\s+)?(?:nächste[nmrs]?)(?:\s+(?:lied|song|titel|track))?(?:\s+(?:ab|bitte))?$/,
      /^(?:überspring\w*|skip\w*)(?:\s+(?:das|den|dieses?n?)?\s*(?:lied|song|titel|track)?)?$/,
      /^(?:lied|song|titel|track)\s+(?:weiter|überspringen|wechseln)$/,
      /^(?:(?:ein|n)\s+)?(?:anderes|neues)\s+(?:lied|song)(?:\s+bitte)?$/,
      /^(?:weiter\s*(?:schalten|springen)|vorspulen|next)$/]],
    ["previous", "Vorheriges Lied.", [
      /^(?:(?:spiel|spiele|mach|nimm|geh\s+zu(?:rück)?)\s+)?(?:das\s+|zum\s+)?(?:vorherige[nmrs]?|letzte[nmrs]?)\s+(?:lied|song|titel|track)(?:\s+nochmal)?$/,
      /^(?:ein\s+)?(?:lied|song)\s+zurück$|^zurück\s*(?:spulen|springen)?$/,
      /^(?:spiel|spiele|mach)\s+(?:das\s+)?(?:lied|song)\s+(?:nochmal|noch\s+einmal|von\s+vorne)$/]],
    ["pause", "Musik pausiert.", [
      /^(?:mach\s+)?(?:(?:eine?|mal)\s+)?pause$/,
      new RegExp("^(?:pausier\\w*|stopp\\w*|stop|halt\\w*|anhalten|beende\\w*|aus)(?:\\s+" + M_ART + "?" + M_OBJ + ")?(?:\\s+an)?$"),
      new RegExp("^(?:" + M_ART + ")?" + M_OBJ + "\\s+(?:aus|stopp\\w*|stop|anhalten|pausier\\w*|beenden|pause|halt)$"),
      new RegExp("^(?:mach|schalt\\w*|dreh\\w*)\\s+(?:" + M_ART + ")?" + M_OBJ + "\\s+aus$"),
      new RegExp("^(?:halt\\w*|stopp\\w*|pausier\\w*)\\s+(?:" + M_ART + ")?" + M_OBJ + "(?:\\s+an)?$")]],
    ["play", "Weiter geht's.", [
      /^(?:weiter|weiter\s*spielen|weiter\s*machen|fortsetzen|fortfahren|fort|resume|play|abspielen|los)$/,
      new RegExp("^(?:spiel|spiele|mach|lass|lasse|setz|setze|fahr|fahre|starte?)\\s+(?:" + M_ART + ")?(?:" + M_OBJ + "\\s+)?(?:wieder\\s+|mal\\s+)?(?:weiter|fort|an|ab|laufen|weiterlaufen|weiterspielen)$"),
      new RegExp("^(?:" + M_ART + ")?" + M_OBJ + "\\s+(?:wieder\\s+)?(?:an|weiter|fortsetzen|starten|abspielen|läuft\\s+weiter|weiterspielen|wieder)$"),
      new RegExp("^(?:spiel|spiele|mach|schalt\\w*|dreh\\w*)\\s+(?:" + M_ART + ")?" + M_OBJ + "\\s+(?:wieder\\s+)?(?:an|ein)$"),
      new RegExp("^(?:" + M_OBJ + "|spiel\\w*|mach)\\s+(?:bitte\\s+)?(?:wieder|weiter)$")]],
    ["louder", "Lauter.", [/^(?:mach\s+|dreh\s+)?(?:die\s+musik\s+|es\s+)?(?:etwas\s+|noch\s+|mal\s+|bisschen\s+)?(?:lauter|auf)(?:\s+machen|\s+drehen)?$/]],
    ["quieter", "Leiser.", [/^(?:mach\s+|dreh\s+)?(?:die\s+musik\s+|es\s+)?(?:etwas\s+|noch\s+|mal\s+|bisschen\s+)?(?:leiser)(?:\s+machen|\s+drehen)?$/]],
  ];
  /** Satz aufräumen: „Hey Jarvis, bitte spiel die Musik weiter.“ -> „spiel die musik weiter“ */
  function mediaClean(text) {
    return text.toLowerCase().trim()
      .replace(/[.,!?;:„“"]+/g, " ")
      .replace(/^\s*(?:hey\s+|hallo\s+|ok\s+)?jarvis\s+/, "")
      .replace(/^(?:kannst\s+du\s+|könntest\s+du\s+|würdest\s+du\s+)/, "")
      .replace(/^(?:bitte|mal|jetzt|und|dann)\s+/, "").replace(/^(?:bitte|mal|jetzt)\s+/, "")
      .replace(/\s+(?:bitte|mal|jetzt|danke)$/, "").replace(/\s+(?:bitte|mal|jetzt)$/, "")
      .replace(/\s+(?:auf|bei|in|über|mit)\s+spotify$/, (m) => m)   // bleibt für die Suche erhalten
      .replace(/\s+/g, " ").trim();
  }
  function mediaCommand(text) {
    let t = mediaClean(text).replace(/\s+(?:auf|bei|in|über|mit)\s+spotify$/, "");
    t = t.replace(/\s+(?:mal|bitte|wieder)\s+/g, m => m.includes("wieder") ? " wieder " : " ").trim();
    for (const [cmd, msg, res] of MEDIA_CMDS) if (res.some(r => r.test(t))) return { cmd, msg };
    return null;
  }

  let musicHold = 0;
  window.__zgMusic = {
    emit(r) {
      musicHold = 0;
      if (r.ok && r.how === "hintergrund") return;
      if (!r.ok) note("Musik: " + (r.msg || "hat nicht geklappt") + ". Details: App-Einstellungen → Musik testen.");
      else if (!r.access && lsGet("zg_music_tip") !== "1") {
        lsSet("zg_music_tip", "1");
        note("Tipp: Erlaube in den App-Einstellungen „Musik im Hintergrund“, dann geht Spotify nicht mehr auf.");
      }
    },
  };
  function handleMedia(text) {
    const quiet = msg => { lastViaVoice = false; assistantSay(msg, true); return true; };   // leise, damit die Musik nicht übertönt wird
    const c = mediaCommand(text);
    if (c) {
      if (!AND) return quiet("Musik steuern geht nur in der Android-App.");
      AND.media(c.cmd);
      return quiet(c.msg);
    }
    // „Spiel Gzuz (auf Spotify)“, „Spiele Musik von Gzuz“, „Spiel das Lied Bonez auf Spotify“
    const t = mediaClean(text);
    const m = /^(?:spiel|spiele|play|hör|höre|leg|lege|mach)\s+(?:mir\s+)?(?:mal\s+)?(.+?)(?:\s+(?:auf|bei|in|über|mit)\s+spotify)?(?:\s+(?:auf|an|ab))?$/i.exec(t);
    if (!m || /^(?:ein\s+|eine\s+)?spiel\b/i.test(m[1])) return false;
    // „mach/hör/leg …“ nur, wenn klar Musik gemeint ist („hör auf“, „leg los“ sind keine Lieder)
    if (/^mach(?![\wäöüß])/.test(t) && !/\b(?:musik|lied|song|spotify|playlist|album)\b/.test(t)) return false;
    if (/^(?:auf|zu|los|mit\s+mir\b.*|mal\s+zu|weiter\s+zu|(?:dich|mich|dir|es|das)\b.*)$/.test(m[1].trim())) return false;
    let q = m[1].replace(/^(?:bitte\s+)?(?:etwas|was|musik|songs?|lieder|das\s+lied|den\s+song|die\s+playlist|ein\s+lied|einen\s+song)\s+/i, "").trim();
    let artist = "";
    const von = /^(?:(?:etwas|was|musik|songs?|lieder|ein\s+lied|einen\s+song)\s+)?von\s+(.+)$/i.exec(q);
    if (von) { q = von[1].trim(); artist = q; }
    // Nur Füllwörter übrig (z. B. „spiel die Musik“, „spiel wieder“)? Dann einfach weiterspielen.
    if (!q || q.length < 2 || /^(?:die|das|den|meine?)?\s*(?:musik|lied|song|was|etwas|wieder|weiter|fort|ab|an|spotify)?$/.test(q)) {
      if (!AND) return quiet("Musik steuern geht nur in der Android-App.");
      AND.media("play");
      return quiet("Weiter geht's.");
    }
    if (!AND) return quiet("Musik abspielen geht nur in der Android-App.");
    musicHold = Date.now() + 25000;          // kleinen Kreis offen lassen, bis Spotify spielt
    const ok = AND.spotifyPlay(q, artist);
    return quiet(ok ? `Ich spiele ${q}.` : "Spotify ist nicht installiert, ich öffne es im Browser.");
  }
