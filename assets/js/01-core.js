  /* ================= Grundlagen ================= */
  /* ================= Android-App: Brücke zu Mikrofon, Stimme, Google und „Hey Jarvis“ ================= */
  // Läuft die Seite in der Zweites-Gehirn-Android-App, übernimmt die App Mikrofon und Stimme (Webseiten dürfen das dort nicht).
  const AND = window.ZGAndroid || null;
  const MINI = !!(AND && AND.isMini && AND.isMini());
  if (MINI) document.body.classList.add("mini");
  if (AND) (function installAndroid() {
    const active = {};
    window.__zgSR = {
      emit(ev) {
        const r = active[ev.sid]; if (!r) return;
        if (ev.type === "result") { const txt = ev.final && ev.alts && ev.alts.length > 1 && window.__zgPickAlt ? window.__zgPickAlt(ev.alts) : ev.text; const res = [[{ transcript: txt }]]; res[0].isFinal = !!ev.final; r.onresult && r.onresult({ resultIndex: 0, results: res }); }
        else if (ev.type === "error") { r.onerror && r.onerror({ error: ev.error }); }
        else if (ev.type === "end") { delete active[ev.sid]; r.onend && r.onend(); }
      },
    };
    class NativeSR {
      constructor() { this.lang = "de-DE"; this.interimResults = true; this.continuous = false; this.maxAlternatives = 1; }
      start() { this.sid = AND.srStart(this.lang, !!this.interimResults); active[this.sid] = this; }
      stop() { if (this.sid) AND.srStop(this.sid); }
      abort() { if (this.sid) AND.srAbort(this.sid); }
    }
    window.SpeechRecognition = window.webkitSpeechRecognition = NativeSR;

    const utt = {}; let voices = [], n = 0;
    const nsynth = {
      speak(u) { const id = "u" + (++n); utt[id] = u; AND.ttsSpeak(id, u.text, u.voice ? u.voice.name : "", u.rate || 1); },
      cancel() { AND.ttsCancel(); },
      getVoices() { return voices; },
      onvoiceschanged: null,
    };
    window.__zgTTS = {
      emit(ev) {
        const u = utt[ev.id]; if (!u) return;
        if (ev.type === "start") { u.onstart && u.onstart({}); return; }
        delete utt[ev.id];
        if (ev.type === "error") { u.onerror && u.onerror({}); } else { u.onend && u.onend({}); }
      },
      voices() { try { voices = JSON.parse(AND.ttsVoices()); } catch { voices = []; } nsynth.onvoiceschanged && nsynth.onvoiceschanged(); },
    };
    try { voices = JSON.parse(AND.ttsVoices()); } catch {}
    window.SpeechSynthesisUtterance = function (t) { this.text = t; this.lang = "de-DE"; this.voice = null; this.rate = 1; };
    try { Object.defineProperty(window, "speechSynthesis", { value: nsynth, configurable: true }); } catch {}
  })();

  const VIA_SERVER = /^https?:$/.test(location.protocol);
  const OLLAMA = VIA_SERVER ? "/ollama" : "http://localhost:11434";
  const PREFERRED_MODEL = "gemma3:4b";
  const TZ = "Europe/Berlin";
  const WD = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const GREETING = "Hallo Damian. Klick auf „Sprich mit mir“ und leg los.";
  const STORE_KEY = "zg_pc_chats";
  const IS_ANDROID = /Android/i.test(navigator.userAgent);

  const $ = id => document.getElementById(id);
  const log = $("log"), input = $("input"), stateEl = $("state"), micBtn = $("mic"), list = $("list"), modelSel = $("model");
  const setDot = (id, cls) => { $(id).className = "dot" + (cls ? " " + cls : ""); };
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  // Geheimes (z. B. Gemini-Schlüssel): in der Android-App verschlüsselt im Handy-Tresor, am PC im Browser
  function secGet(k) {
    if (!(AND && AND.secretGet)) return lsGet(k) || "";
    let v = ""; try { v = AND.secretGet(k) || ""; } catch {}
    const old = lsGet(k);
    if (old) {   // einmalig aus dem normalen Speicher in den Tresor umziehen
      if (!v) { try { AND.secretSet(k, old); v = AND.secretGet(k) || ""; } catch {} }
      if (v) try { localStorage.removeItem(k); } catch {}
      else v = old;
    }
    return v;
  }
  function secSet(k, v) {
    if (AND && AND.secretSet) { try { AND.secretSet(k, v || ""); try { localStorage.removeItem(k); } catch {} return; } catch {} }
    lsSet(k, v || "");
  }
  // Auf dem Sperrbildschirm (kleiner Kreis) keine privaten Dinge zeigen
  const deviceLocked = () => { try { return !!(AND && AND.deviceLocked && AND.deviceLocked()); } catch { return false; } };
  // fetch mit Zeitlimit (Standard 15 s), damit Wetter/Kurse/Wallet nie ewig hängen
  const fetchT = (url, opts = {}, ms = 15000) => fetch(url, { ...opts, signal: opts.signal || (AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined) });
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sayDate = d => `${WD[d.getDay()]}, ${d.getDate()}. ${d.toLocaleDateString("de-DE", { month: "long" })}`;
  const sayTime = d => d.getMinutes() ? `${d.getHours()}:${pad(d.getMinutes())} Uhr` : `${d.getHours()} Uhr`;

  function RULES() {
    const n = new Date();
    return `Du bist die KI in Damians App 'Zweites Gehirn'. Damian macht eine Ausbildung zum Elektroniker für Automatisierungstechnik. Er ruft dich manchmal mit „Hey Jarvis“. Heute ist ${WD[n.getDay()]}, der ${n.toLocaleDateString("de-DE")}, ${pad(n.getHours())}:${pad(n.getMinutes())} Uhr. Deine Antworten werden laut vorgelesen: Antworte immer auf Deutsch, natürlich wie im Gespräch, kurz und klar (meist 1 bis 3 Sätze), außer er will mehr Details. Keine Markdown-Formatierung, keine Sternchen, keine Aufzählungszeichen, keine Emojis. Die App kann auf dem Handy Kontakte anrufen, WhatsApp-Nachrichten schreiben, den Stand der Phantom Wallet ansagen, ein Tagebuch führen (sag „Tagebuch“), ein Morgen-Briefing geben, das Wetter ansagen, Einkaufs- und To-do-Listen führen, Erinnerungen und Timer stellen, abfragen zum Lernen (Lernmodus), den Stundenplan und Arbeiten merken, Budgets überwachen, Kurs-Alarme stellen, navigieren und sich Dinge merken („Merk dir …“), Kontostand, Einnahmen, Ausgaben und Fixkosten vom Bankkonto zusammenfassen, Musik auf Spotify abspielen und steuern, Wecker stellen (auch auf der Alexa), Termine eintragen und anzeigen, Mails prüfen, zusammenfassen und als Entwurf schreiben und Kontakte nachschlagen. Behaupte nie, du hättest so etwas selbst erledigt. Du selbst hast KEINEN Zugriff auf Wallet-, Konto- oder Kursdaten: Erfinde niemals Beträge, Kontostände oder Kurse. Fragt Damian nach seiner Wallet, sag ihm, er soll genau so fragen: „Wie sieht's aus in meiner Phantom Wallet?“` + (typeof memoryContext === "function" ? memoryContext() : "");
  }

  let chats = [], currentId = null, messages = [];
  let model = null, ollamaOk = false;
  let busy = false, listening = false, speaking = false;
  let voiceOn = true, loopOn = true, lastViaVoice = false;
  let ctl = null, rec = null, armedDelete = null;
  let pending = null;   // offene Rückfrage (Termin eintragen / Entwurf speichern)

  /* ================= Uhr ================= */
  function tick() {
    const n = new Date();
    $("time").textContent = n.toLocaleTimeString("de-DE");
    $("date").textContent = n.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  tick(); setInterval(tick, 1000);

  /* ================= Speicher (PC-Ordner über den Server, Browser als Zwischenspeicher) ================= */
  let serverStore = false;
  function loadLocal() {
    try { chats = JSON.parse(lsGet(STORE_KEY) || "[]"); } catch { chats = []; }
    if (!Array.isArray(chats)) chats = [];
  }
  function saveLocal() { lsSet(STORE_KEY, JSON.stringify(chats)); lsSet("zg_deleted", JSON.stringify(deleted)); }
  // Gelöschte Chats merken, damit sie beim Abgleich mit Drive nicht wieder auftauchen
  let deleted = [];
  try { deleted = JSON.parse(lsGet("zg_deleted") || "[]"); if (!Array.isArray(deleted)) deleted = []; } catch { deleted = []; }
  function mergeInto(list, delList) {
    for (const d of delList || []) if (d && d.id && !deleted.some(x => x.id === d.id)) deleted.push(d);
    const byId = new Map(chats.map(c => [c.id, c]));
    for (const c of list || []) {
      if (!c || !c.id || !Array.isArray(c.messages)) continue;
      const mine = byId.get(c.id);
      if (!mine || (c.updated || 0) > (mine.updated || 0)) byId.set(c.id, c);
    }
    chats = [...byId.values()].filter(c => !deleted.some(d => d.id === c.id && d.ts >= (c.updated || 0)));
  }
  const safeName = s => (s || "Gespräch").replace(/[\\/:*?"<>|\r\n]+/g, "-").trim().slice(0, 48) || "Gespräch";
  const tStr = ts => new Date(ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  function mdOf(c) {
    let md = `# ${c.title}\n\nErstellt: ${new Date(c.created).toLocaleString("de-DE")}\nZuletzt geändert: ${new Date(c.updated).toLocaleString("de-DE")}\nQuelle: Zweites Gehirn (PC/Handy, Ollama)\n\n`;
    for (const m of c.messages) md += `**${m.role === "user" ? "Damian" : "KI"}** (${tStr(m.ts)}):\n${m.content}\n\n`;
    return md;
  }
  async function uploadChat(c) {
    if (!serverStore) return;
    try {
      await fetch("/data/chats/" + c.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
      await fetch("/data/md?name=" + encodeURIComponent(`PC ${ymd(new Date(c.created))} ${safeName(c.title)} [${c.id}].md`), { method: "PUT", headers: { "Content-Type": "text/markdown; charset=utf-8" }, body: mdOf(c) });
    } catch { note("Speichern auf dem PC hat gerade nicht geklappt. Läuft das Server-Fenster?"); }
  }
  async function fetchServerChats() {
    const r = await fetch("/data/chats", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    return Array.isArray(data) ? data.filter(c => c && c.id && Array.isArray(c.messages)) : [];
  }
  async function initStore() {
    loadLocal();
    if (VIA_SERVER) {
      try {
        const remote = await fetchServerChats();
        serverStore = true;
        const byId = new Map(remote.map(c => [c.id, c]));
        for (const c of chats) {            // ältere Chats aus dem Browser einmalig auf den PC übertragen
          const r = byId.get(c.id);
          if (!r || c.updated > r.updated) { byId.set(c.id, c); await uploadChat(c); }
        }
        chats = [...byId.values()].filter(c => !deleted.some(d => d.id === c.id && d.ts >= (c.updated || 0)));
        saveLocal();
      } catch { serverStore = false; }
    }
    updateStoreUi();
  }
  function updateStoreUi() {
    const parts = [];
    if (serverStore) parts.push("PC-Ordner");
    if (driveReady()) parts.push("Google Drive");
    if (parts.length) { setDot("stDot", "ok"); $("stV").textContent = "Gespeichert in: " + parts.join(" + "); }
    else { setDot("stDot", "warn"); $("stV").textContent = gClientId ? "Nur auf diesem Gerät. Tipp auf „Google verbinden“, dann wird in Drive gespeichert." : "Nur auf diesem Gerät. Mit Google verbinden, damit alles überall gleich ist."; }
  }
  async function syncFromServer() {          // wenn am Handy oder PC etwas dazugekommen ist
    if (busy || listening) return;
    if (serverStore) { try { mergeInto(await fetchServerChats(), []); } catch {} }
    if (driveReady()) await driveSync(false);
    saveLocal();
    const c = chats.find(x => x.id === currentId);
    if (c && c.messages.length !== messages.length && !speaking) openChat(c); else renderAll();
  }
  window.addEventListener("focus", syncFromServer);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncFromServer(); });

  async function persist() {
    const now = Date.now();
    let c = chats.find(x => x.id === currentId);
    if (!c) {
      const first = messages.find(m => m.role === "user");
      currentId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      c = { id: currentId, title: first ? first.content.slice(0, 48) : "Gespräch", created: now, updated: now, messages: [] };
      chats.push(c);
    }
    c.messages = messages.map(m => ({ ...m })); c.updated = now;
    saveLocal(); renderAll();
    scheduleDriveSave();
    await uploadChat(c);
  }

  /* ================= Stimme (Ausgabe) ================= */
  const synth = window.speechSynthesis || null;
  let voice = null, queue = 0;
  function pickVoice() {
    if (!synth) return;
    const vs = synth.getVoices().filter(v => /^de/i.test(v.lang));
    const saved = lsGet("zg_voice");
    if (AND) voice = vs.find(v => v.name === saved) || null;   // null = die App nimmt automatisch die beste Google-Stimme
    else voice = vs.find(v => v.name === saved) || vs.find(v => /natural/i.test(v.name)) || vs.find(v => /online|google/i.test(v.name)) || vs[0] || null;
    updateVoiceUi();
  }
  // Tippen auf „Stimme“ im Status wechselt die Stimme und spielt eine Probe ab
  function cycleVoice() {
    if (!synth) return;
    const vs = synth.getVoices().filter(v => /^de/i.test(v.lang));
    if (!vs.length) { note("Keine deutschen Stimmen gefunden. Installiere in den Handy-Einstellungen „Sprachausgabe von Google“."); return; }
    const opts = AND ? [null, ...vs] : vs;
    const i = opts.findIndex(v => (v ? v.name : null) === (voice ? voice.name : null));
    voice = opts[(i + 1) % opts.length];
    lsSet("zg_voice", voice ? voice.name : "");
    updateVoiceUi(); hush();
    speak("Hallo Damian, so klinge ich jetzt.");
  }
  const voiceLabel = v => {
    if (!v) return AND ? "Automatisch (beste Google-Stimme)" : "Deutsche Standardstimme";
    const m = /^de-de-x-(\w+)-(network|local)$/i.exec(v.name);
    return m ? `Google ${m[1].toUpperCase()} (${m[2] === "network" ? "online, natürlicher" : "offline"})` : v.name;
  };
  // Aus mehreren Erkennungs-Vorschlägen den nehmen, der am besten zu Jarvis-Befehlen passt
  const VOCAB = /\b(jarvis|spotify|whatsapp|phantom|wallet|alexa|tagebuch|einkaufsliste|to-?dos?|sps|sparkasse|fixkosten|budget|briefing|wecker|timer|stundenplan|kontostand|guthaben|erinner\w*|merk dir|navigier\w*|wetter|termin\w*|mails?|lied|musik|pause|weiter|ruf|schreib|spiel)\b/gi;
  window.__zgPickAlt = alts => {
    let best = alts[0], bestScore = -1;
    alts.forEach((a, i) => {
      let sc = (a.match(VOCAB) || []).length * 2 + (i === 0 ? 1.5 : 0) - i * 0.2;
      try { if (typeof mediaCommand === "function" && mediaCommand(a)) sc += 3; } catch {}
      if (sc > bestScore) { bestScore = sc; best = a; }
    });
    return best;
  };
  function updateVoiceUi() {
    $("cVoiceState").textContent = voiceOn ? "AN" : "AUS";
    if (!synth) { setDot("vDot", "bad"); $("vV").textContent = "Browser kann nicht vorlesen"; return; }
    setDot("vDot", voiceOn ? "ok" : "");
    $("vV").textContent = voiceOn ? voiceLabel(voice) + " · antippen zum Wechseln" : "Aus";
  }
  if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; } else updateVoiceUi();
  $("vV").style.cursor = "pointer"; $("vV").parentElement.addEventListener("click", cycleVoice);

  // Text erscheint genau dann, wenn die Stimme ihn spricht
  let bubbleEl = null, shown = "", fullAnswer = "";
  function reveal(chunk) {
    if (!bubbleEl) return;
    shown += chunk;
    bubbleEl.classList.remove("wait");
    bubbleEl.textContent = shown.trim();
    log.scrollTop = log.scrollHeight;
  }
  function revealAll() {
    if (bubbleEl && fullAnswer) { shown = fullAnswer; bubbleEl.classList.remove("wait"); bubbleEl.textContent = fullAnswer.trim(); }
  }
  const voiceActive = () => !!synth && voiceOn;

  let ttsEpoch = 0;   // wird bei jedem Stoppen erhöht, damit alte Sätze nicht weiterlaufen
  // Für die Stimme aufbereiten: Zeichen aussprechbar machen, Emojis weg – klingt deutlicher
  const cleanSpeech = text => text.replace(/[*#_`>]/g, "")
      .replace(/\p{Extended_Pictographic}|[\u{FE0F}\u{200D}✓✗☐▲▼•◎]/gu, "")
      .replace(/(\d)\s*€/g, "$1 Euro").replace(/€/g, "Euro").replace(/(\d)\s*%/g, "$1 Prozent").replace(/°\s*C/g, " Grad")
      .replace(/\bz\.\s*B\./g, "zum Beispiel").replace(/\bca\./g, "circa").replace(/\bbzw\./g, "beziehungsweise").replace(/\bu\.\s*a\./g, "unter anderem")
      .replace(/\s+&\s+/g, " und ").replace(/\s[–—]\s/g, ", ").replace(/\s{2,}/g, " ").trim();
  function speak(text, onShow) {
    const clean = cleanSpeech(text);
    if (!voiceActive() || !clean) { onShow && onShow(); return; }
    const ep = ttsEpoch;
    let shownOnce = false;
    const show = () => { if (!shownOnce) { shownOnce = true; onShow && onShow(); } };
    queue++; speaking = true; refreshUi();
    const finish = () => {
      if (ep !== ttsEpoch) return;
      show();
      queue = Math.max(0, queue - 1);
      if (!queue) pump();
      if (!queue) { speaking = false; refreshUi(); if (!busy) revealAll(); maybeListenAgain(); scheduleWake(700); }
    };
    const viaSystem = () => {
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = "de-DE"; if (voice) u.voice = voice; u.rate = AND ? 1.0 : 1.05;
      u.onstart = show;
      u.onend = u.onerror = finish;
      synth.speak(u);
    };
    // KI-Stimme (Gemini): klingt natürlicher; bei Fehlern automatisch die normale Stimme
    if (typeof aiVoiceUsable === "function" && aiVoiceUsable()) {
      aiSpeak(clean, ep, show, finish, viaSystem);
      return;
    }
    viaSystem();
  }
  function hush() { ttsEpoch++; if (synth) synth.cancel(); try { aiStop(); } catch {} queue = 0; speaking = false; spokenUpTo = fullAnswer.length; revealAll(); refreshUi(); }

  // Fließend sprechen: immer nur ein Stück gleichzeitig, danach alles bis dahin Fertige in einem Rutsch
  let spokenUpTo = 0, genDone = false;
  function pump() {
    if (!voiceActive() || queue > 0) return;
    const rest = fullAnswer.slice(spokenUpTo);
    if (!rest.trim()) return;
    const words = t => t.trim().split(/\s+/).filter(Boolean).length;
    let cut = -1, m;
    if (typeof aiVoiceUsable === "function" && aiVoiceUsable()) {
      // KI-Stimme: Satz für Satz (immer gleich geschnitten), damit der nächste Satz schon vorab geladen werden kann
      cut = aiCut(rest, genDone);
      if (cut > 0) {
        const chunk = rest.slice(0, cut); spokenUpTo += cut;
        speak(chunk, () => reveal(chunk));
        const nxt = fullAnswer.slice(spokenUpTo), c2 = aiCut(nxt, genDone);
        if (c2 > 0) aiPrefetch(cleanSpeech(nxt.slice(0, c2)));
      }
      return;
    }
    if (genDone) cut = rest.length;
    else {
      const re = /[.!?…:;]+["»“)]?\s+|\n+/g;
      while ((m = re.exec(rest))) cut = m.index + m[0].length;
      if (cut < 0 && spokenUpTo === 0) {
        const rc = /,\s+/g;
        while ((m = rc.exec(rest))) if (words(rest.slice(0, m.index)) >= 5) cut = m.index + m[0].length;
      }
      if (cut < 0 && words(rest) >= 25) cut = rest.trimEnd().lastIndexOf(" ") + 1;
    }
    if (cut > 0) {
      const chunk = rest.slice(0, cut);
      spokenUpTo += cut;
      speak(chunk, () => reveal(chunk));
    }
  }

  /* ================= Mikrofon (Eingabe) ================= */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { setDot("micDot", "bad"); $("micV").textContent = "Nur in Edge oder Chrome verfügbar"; }
  else setDot("micDot", "ok");

  const PAUSES = [1500, 2500, 4000];
  let pauseMs = 2500;
  { const p = +lsGet("zg_pc_pause"); if (PAUSES.includes(p)) pauseMs = p; }

  function listen(keepText) {
    if (!SR) { note("Spracheingabe geht nur in Edge oder Chrome."); return; }
    if (busy || listening) return;
    stopWake();
    hush();
    rec = (typeof aiEarUsable === "function" && aiEarUsable()) ? new GemSR() : new SR();
    // Am PC hört der Browser durchgehend zu, auf Android klappt das nicht zuverlässig: dort wird bei Bedarf neu gestartet
    rec.lang = "de-DE"; rec.interimResults = true; rec.continuous = !IS_ANDROID; rec.maxAlternatives = 1;
    const before = keepText ? input.value.trim() + " " : "";
    let cancelled = false, stopRequested = false, lastSpeech = Date.now(), timer = null;
    const armTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (rec && input.value.trim()) { stopRequested = true; rec.stop(); } }, pauseMs);
    };
    rec.onresult = e => {
      let finalText = "", interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + " "; else interim += r[0].transcript;
      }
      input.value = (before + finalText + interim).replace(/\s+/g, " ").trim();
      lastSpeech = Date.now();
      armTimer();
    };
    rec.onerror = e => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
        cancelled = true; loopOn = false; updateLoopUi();
        setDot("micDot", "bad");
        $("micV").textContent = e.error === "audio-capture" ? "Kein Mikrofon gefunden" : "Kein Zugriff aufs Mikrofon";
        note((e.error === "audio-capture"
          ? "Es wurde kein Mikrofon gefunden. Ist eins angeschlossen?"
          : e.error === "service-not-allowed"
          ? "Der Browser lässt die Spracherkennung nicht zu. Prüf in Windows: Einstellungen → Datenschutz → Spracherkennung → Online-Spracherkennung auf Ein."
          : !isSecureContext
          ? "Das Mikrofon geht nur über localhost oder die https-Adresse von Tailscale."
          : "Das Mikrofon ist blockiert. Tipp oben in der Adressleiste auf das Schloss-Symbol, stell Mikrofon auf „Zulassen“ und lade die Seite neu.")
          + " (Fehlercode: " + e.error + ")");
      } else if (e.error === "network") {
        cancelled = true; note("Die Spracherkennung braucht Internet. Prüf deine Verbindung.");
      } else if (e.error === "aborted") {
        cancelled = true;
      } else if (e.error === "no-speech") {
        cancelled = !input.value.trim();   // schon Gesagtes nicht wegwerfen
      }
    };
    rec.onend = () => {
      clearTimeout(timer);
      listening = false; rec = null; refreshUi();
      const t = input.value.trim();
      // Browser hat mitten im Satz aufgehört -> weiter zuhören (die Android-App erkennt das Satzende selbst)
      if (!AND && !cancelled && !stopRequested && t && Date.now() - lastSpeech < pauseMs) { listen(true); return; }
      if (!cancelled && t) { input.value = ""; ask(t, true); }
      else scheduleWake(400);
    };
    rec.userStop = () => { stopRequested = true; };
    listening = true; refreshUi();
    try { rec.start(); } catch { listening = false; refreshUi(); }
  }
  function stopListening(cancel) {
    if (!rec) return;
    if (cancel) { input.value = ""; rec.abort(); } else { rec.userStop(); rec.stop(); }
  }
  function maybeListenAgain() {
    if (loopOn && lastViaVoice && !busy && !speaking && !listening && ollamaOk) setTimeout(() => { if (!busy && !speaking && !listening) listen(); }, 350);
  }

  const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
  micBtn.addEventListener("pointerdown", () => buzz(12));
  micBtn.onclick = () => {
    if (wakeRec) { stopWake(); listen(); return; }
    if (busy) {
      if (ctl) ctl.abort();
      if (typeof finWait !== "undefined" && finWait) { const w = finWait; finWait = null; w(null); }
      hush();
      setTimeout(() => { if (busy) { busy = false; refreshUi(); } }, 2000);   // Notbremse, falls etwas hängt
      return;
    }
    if (speaking) { hush(); lastViaVoice = false; return; }
    if (listening) { stopListening(false); return; }
    listen();
  };
  document.addEventListener("keydown", e => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (e.code === "Space" && !e.repeat && !["TEXTAREA", "INPUT", "BUTTON", "SELECT", "A"].includes(tag)) { e.preventDefault(); micBtn.click(); }
  });

  /* ================= Anzeige ================= */
  function refreshUi() {
    micBtn.classList.toggle("live", listening);
    micBtn.classList.toggle("busy", busy || speaking);
    $("micTitle").textContent = listening ? "ICH HÖRE ZU" : busy ? "STOPP" : speaking ? "STILL" : "SPRICH MIT MIR";
    $("micSub").textContent = listening ? "Sprich ruhig, klick wenn du fertig bist" : busy ? "Antwort abbrechen" : speaking ? "Vorlesen beenden" : (IS_ANDROID ? "Antippen" : "Klicken oder Leertaste");
    stateEl.textContent = listening ? "Hört zu …" : busy && !speaking ? "Denkt nach …" : speaking ? "Spricht …"
      : wakeHeard ? "Ja? Ich höre …" : (wakeOn && backend && !document.hidden) ? "Wartet auf „Hey Jarvis“" : "Bereit";
    $("cNew").disabled = busy;
    document.body.dataset.st = listening ? "listen" : busy && !speaking ? "think" : speaking ? "speak" : "idle";
  }
  function add(cls, text) {
    const el = document.createElement("div");
    el.className = cls; el.textContent = text; log.append(el);
    log.scrollTop = log.scrollHeight; markChatting(); return el;
  }
  const note = t => { const l = log.lastElementChild; if (l && l.className === "note" && l.textContent === t) return l; return add("note", t); };
  function markChatting() { const c = $("core"); if (c) c.classList.toggle("chatting", log.children.length > (MINI ? 0 : 1)); }
  function renderChat() {
    log.textContent = ""; markChatting();
    if (!MINI) add("msg ai", GREETING);
    for (const m of messages) add(m.role === "user" ? "msg me" : "msg ai", m.content);
  }
  const fmt = ts => ts ? new Date(ts).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  function renderList() {
    list.textContent = "";
    $("histCount").textContent = chats.filter(c => !c.hidden).length;
    if (!chats.some(c => !c.hidden)) { list.innerHTML = '<p class="empty">Noch keine Gespräche. Alles, was du sagst, wird automatisch gespeichert.</p>'; return; }
    const q = (($("hSearch") && $("hSearch").value) || "").trim().toLowerCase();
    let shown = 0, lastGroup = "";
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const group = ts => ts >= +t0 ? "Heute" : ts >= +t0 - 864e5 ? "Gestern" : ts >= +t0 - 6 * 864e5 ? "Diese Woche" : ts >= +t0 - 30 * 864e5 ? "Dieser Monat" : "Älter";
    for (const c of [...chats].filter(c => !c.hidden).sort((a, b) => b.updated - a.updated)) {
      let hit = "";
      if (q) {
        if (!(c.title || "").toLowerCase().includes(q)) {
          const m = c.messages.find(m => (m.content || "").toLowerCase().includes(q)); if (!m) continue;
          const i = m.content.toLowerCase().indexOf(q); hit = (i > 30 ? "… " : "") + m.content.slice(Math.max(0, i - 30), i + 60).replace(/\s+/g, " ");
        }
      }
      shown++;
      const g = group(c.updated || 0);
      if (!q && g !== lastGroup) { const h = document.createElement("div"); h.className = "grp"; h.textContent = g; list.append(h); lastGroup = g; }
      const row = document.createElement("div");
      row.className = "item" + (c.id === currentId ? " active" : "");
      const open = document.createElement("button");
      open.type = "button"; open.className = "open";
      const t = document.createElement("span"); t.className = "t"; t.textContent = c.title;
      const d = document.createElement("span"); d.className = "d"; d.textContent = fmt(c.updated);
      open.append(t, d);
      if (hit) { const h = document.createElement("span"); h.className = "hit"; h.textContent = hit; open.append(h); }
      open.onclick = () => { if (busy) return; hush(); stopListening(true); openChat(c); };
      const del = document.createElement("button");
      del.type = "button"; del.className = "del" + (armedDelete === c.id ? " confirm" : "");
      del.textContent = armedDelete === c.id ? "Wirklich?" : "Löschen";
      del.onclick = async () => {
        if (armedDelete !== c.id) { armedDelete = c.id; renderList(); return; }
        armedDelete = null;
        chats = chats.filter(x => x.id !== c.id);
        deleted.push({ id: c.id, ts: Date.now() }); saveLocal();
        if (serverStore) fetch("/data/chats/" + c.id, { method: "DELETE" }).catch(() => {});
        scheduleDriveSave();
        if (c.id === currentId) newChat(); else renderAll();
      };
      row.append(open, del); list.append(row);
    }
    if (q && !shown) list.innerHTML = '<p class="empty">Nichts gefunden. Tipp: Frag Jarvis „Was hab ich über … gesagt?“</p>';
  }
  function renderStats() {
    const today = new Date().toDateString();
    let msgs = 0, todayN = 0;
    for (const c of chats.filter(c => !c.hidden)) { msgs += c.messages.length; todayN += c.messages.filter(m => new Date(m.ts).toDateString() === today).length; }
    $("sChats").textContent = chats.filter(c => !c.hidden).length; $("sMsgs").textContent = msgs; $("sToday").textContent = todayN;
  }
  function renderAll() { renderList(); renderStats(); }
  // Laufende Modi (Lernmodus, Tagebuch) beenden, wenn man das Gespräch wechselt
  function resetModes() {
    if (typeof learn !== "undefined") learn = null;
    if (typeof diaryMode !== "undefined" && diaryMode) { stopDiaryMode(); diaryParts = []; }
  }
  function openChat(c) { resetModes(); currentId = c.id; messages = c.messages.map(m => ({ ...m })); pending = null; renderChat(); renderAll(); }
  function newChat() {
    if (busy) return;
    hush(); stopListening(true); resetModes();
    currentId = null; messages = []; pending = null; renderChat(); renderAll();
  }


  /* ================= „Hey Jarvis“: wartet auf das Aktivierungswort, solange die App offen ist ================= */
  const WAKE_RE = /\b(?:hey|hei|hej|he|hi|hallo|ey|äh)[\s,.!]*(?:jarvis|javis|jarwis|jarvin|jervis|dschawis+|dschawiss|tscharwis|tschawis|charvis|schaffis|jarvi)\b/i;
  let wakeOn = lsGet("zg_wake") === "1", wakeRec = null, wakeHeard = false, wakeTimer = null, screenLock = null;
  function beep() {
    try {
      const a = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
      if (a.state === "suspended") a.resume();
      const o = a.createOscillator(), g = a.createGain();
      o.frequency.value = 880; g.gain.setValueAtTime(.15, a.currentTime); g.gain.exponentialRampToValueAtTime(.001, a.currentTime + .18);
      o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + .2);
    } catch {}
  }
  const canWake = () => wakeOn && SR && backend && !busy && !speaking && !listening && !wakeRec && !document.hidden;
  function scheduleWake(ms) { clearTimeout(wakeTimer); if (wakeOn) wakeTimer = setTimeout(startWake, ms); }
  function stopWake() {
    clearTimeout(wakeTimer);
    if (wakeRec) { const r = wakeRec; wakeRec = null; wakeHeard = false; r.onend = null; try { r.abort(); } catch {} refreshUi(); }
  }
  function startWake() {
    if (AND || !canWake()) return;
    const r = new SR(); wakeRec = r; wakeHeard = false;
    r.lang = "de-DE"; r.interimResults = true; r.continuous = !IS_ANDROID; r.maxAlternatives = 1;
    let cmd = "", t = null;
    r.onresult = e => {
      let txt = "";
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript + " ";
      const m = WAKE_RE.exec(txt);
      if (!m) return;
      if (!wakeHeard) { wakeHeard = true; beep(); refreshUi(); }
      cmd = txt.slice(m.index + m[0].length).replace(/^[\s,.!?]+/, "").trim();
      input.value = cmd;
      clearTimeout(t);
      t = setTimeout(() => { try { r.stop(); } catch {} }, cmd ? pauseMs : 1500);
    };
    r.onerror = e => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
        wakeOn = false; lsSet("zg_wake", "0"); updateWakeUi();
        note("„Hey Jarvis“ braucht Zugriff aufs Mikrofon. Erlaube es oben in der Adressleiste und schalte es dann wieder an.");
      }
    };
    r.onend = () => {
      clearTimeout(t);
      const heard = wakeHeard;
      wakeRec = null; wakeHeard = false; refreshUi();
      if (heard) { input.value = ""; if (cmd) ask(cmd, true); else listen(); return; }
      scheduleWake(IS_ANDROID ? 250 : 400);
    };
    try { r.start(); } catch { wakeRec = null; scheduleWake(1500); }
    refreshUi();
  }
  async function lockScreen() {
    if (!wakeOn || document.hidden || !("wakeLock" in navigator) || screenLock) return;
    try { screenLock = await navigator.wakeLock.request("screen"); screenLock.addEventListener("release", () => { screenLock = null; }); } catch {}
  }
  function updateWakeUi() {
    $("cWakeState").textContent = wakeOn ? "AN" : "AUS";
    if (!wakeOn) { stopWake(); if (screenLock) { screenLock.release().catch(() => {}); screenLock = null; } }
    refreshUi();
  }
  $("cWake").onclick = () => {
    if (AND) {   // Android-App: ein Dienst hört im Hintergrund, auch wenn die App zu ist
      wakeOn = !wakeOn; lsSet("zg_wake", wakeOn ? "1" : "0"); AND.wakeSet(wakeOn); updateWakeUi();
      if (wakeOn) { beep(); note("„Hey Jarvis“ ist an – auch im Hintergrund. Oben in der Benachrichtigungsleiste siehst du, dass die App wartet."); }
      return;
    }
    if (!SR) { note("„Hey Jarvis“ geht nur in Chrome oder Edge."); return; }
    wakeOn = !wakeOn; lsSet("zg_wake", wakeOn ? "1" : "0");
    updateWakeUi();
    if (wakeOn) { beep(); lockScreen(); scheduleWake(300); note("Sag „Hey Jarvis“ und dann deine Frage. Die App muss dafür offen bleiben, der Bildschirm bleibt an."); }
  };
  document.addEventListener("visibilitychange", () => {
    if (AND) return;
    if (document.hidden) stopWake();
    else if (wakeOn) { lockScreen(); scheduleWake(500); }
  });
  // Android-App: „Hey Jarvis“ wurde im Hintergrund gehört -> sofort zuhören
  function nativeWake() {
    if (!backend) return false;
    if (listening) return true;
    if (busy && !speaking) return false;              // gerade eine Aktion (z. B. Bank) – nicht stören
    const interrupted = busy || speaking;
    if (busy) { try { ctl && ctl.abort(); } catch {} } // Unterbrechen: laufende Antwort abbrechen
    hush(); beep();
    let tries = 0;
    const go = () => { if (busy && tries++ < 15) { setTimeout(go, 100); return; } listen(); };
    setTimeout(go, interrupted ? 250 : 150);
    return true;
  }
  window.__zgWake = () => nativeWake();
  window.__zgWakeState = on => { wakeOn = !!on; lsSet("zg_wake", on ? "1" : "0"); updateWakeUi(); };
  window.__zgResume = () => {
    try { mergeInto(JSON.parse(lsGet(STORE_KEY) || "[]"), JSON.parse(lsGet("zg_deleted") || "[]")); renderAll(); } catch {}
    syncFromServer();
  };
  if (AND) { $("cApp").hidden = false; $("cApp").onclick = () => AND.openSetup(); }


  /* ---------- Kleiner Kreis: schließt sich von selbst, wenn nichts mehr passiert ---------- */
  function startMiniWatch() {
    let lastActive = Date.now(), hadTalk = false;
    const opened = Date.now();
    setInterval(() => {
      const active = busy || speaking || listening || Date.now() < musicHold || diaryMode || !!learn;
      if (active) { lastActive = Date.now(); hadTalk = true; return; }
      const idle = Date.now() - lastActive;
      if (pending) { if (idle > 20000) AND.miniClose(); return; }              // Rückfrage offen: etwas länger warten
      if (hadTalk && idle > 2500) AND.miniClose();                             // fertig
      else if (!hadTalk && Date.now() - opened > 9000) AND.miniClose();        // nie etwas gehört
    }, 500);
    const close = () => { hush(); stopListening(true); if (ctl) ctl.abort(); AND.miniClose(); };
    $("orb").parentElement.addEventListener("click", close);
    $("miniFull").onclick = () => { hush(); stopListening(true); AND.openFullApp(); };
  }

  /* ================= Befehle ================= */
  function updateLoopUi() { $("cLoopState").textContent = loopOn ? "AN" : "AUS"; }
  function updatePauseUi() { $("cPauseState").textContent = (pauseMs / 1000).toLocaleString("de-DE") + " S"; }
  $("cNew").onclick = newChat;
  $("cLoop").onclick = () => { loopOn = !loopOn; updateLoopUi(); };
  $("cVoice").onclick = () => { voiceOn = !voiceOn; if (!voiceOn) hush(); updateVoiceUi(); };
  $("cPause").onclick = () => { pauseMs = PAUSES[(PAUSES.indexOf(pauseMs) + 1) % PAUSES.length]; lsSet("zg_pc_pause", pauseMs); updatePauseUi(); };
  modelSel.onchange = () => { model = modelSel.value; lsSet("zg_pc_model", model); checkAi().then(warmUp); };
