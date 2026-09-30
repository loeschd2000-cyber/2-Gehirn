  /* ================= KI-Stimme (Gemini): natürlicher als die Handy-Stimme =================
     Wird Satz für Satz erzeugt; der nächste Satz lädt schon, während der aktuelle läuft.
     Klappt etwas nicht (kein Internet, Limit erreicht), spricht automatisch die normale Stimme. */
  const AI_VOICES = ["Charon", "Orus", "Fenrir", "Puck", "Kore", "Aoede"];
  let aiVoiceName = AI_VOICES.includes(lsGet("zg_ai_voice")) ? lsGet("zg_ai_voice") : "";   // "" = aus
  let aiBlockedUntil = 0, aiCtx = null, aiSrc = null;
  const aiCache = new Map();
  const ttsModelList = () => (typeof gemAllModels !== "undefined" ? gemAllModels : []).filter(n => /tts/.test(n))
    .sort((a, b) => (/flash/.test(b) - /flash/.test(a)) || (/preview/.test(a) - /preview/.test(b)) || b.localeCompare(a));
  let ttsDead = new Set();

  function aiVoiceUsable() { return !!aiVoiceName && !!geminiKey && Date.now() > aiBlockedUntil && ttsModelList().some(m => !ttsDead.has(m)); }

  function aiCut(rest, done) {
    const words = t => t.trim().split(/\s+/).filter(Boolean).length;
    const re = /[.!?…:;]+["»“)]?\s+|\n+/g; let m;
    while ((m = re.exec(rest))) { const end = m.index + m[0].length; if (words(rest.slice(0, end)) >= 4) return end; }
    if (done) return rest.trim() ? rest.length : -1;
    return words(rest) >= 30 ? rest.trimEnd().lastIndexOf(" ") + 1 : -1;
  }

  async function gemTts(text) {
    for (const m of ttsModelList()) {
      if (ttsDead.has(m)) continue;
      const r = await fetch(`${GEM}/${m}:generateContent`, {
        method: "POST", signal: AbortSignal.timeout(20000),
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: aiVoiceName } } } } }),
      });
      if (!r.ok) {
        const t = await r.text();
        if (r.status === 404 || /not found|no longer|not supported|deprecated/i.test(t)) { ttsDead.add(m); continue; }
        throw new Error("KI-Stimme " + r.status);
      }
      const j = await r.json();
      const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
      const p = parts.find(x => x.inlineData && x.inlineData.data);
      if (!p) throw new Error("keine Audiodaten");
      return p.inlineData;
    }
    throw new Error("kein Stimm-Modell");
  }
  function aiPrefetch(clean) {
    if (!clean || aiCache.has(clean)) return;
    const pr = gemTts(clean); pr.catch(() => {});
    aiCache.set(clean, pr);
    if (aiCache.size > 8) aiCache.delete(aiCache.keys().next().value);
  }
  async function playPcm(inl, onStart, onEnd) {
    aiCtx = aiCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (aiCtx.state !== "running") {
      // Browser erlaubt Ton erst nach einem Klick: nicht ewig hängen, sondern normale Stimme nehmen
      await Promise.race([aiCtx.resume().catch(() => {}), new Promise(r => setTimeout(r, 400))]);
      if (aiCtx.state !== "running") throw new Error("Ton gesperrt");
    }
    const rate = +((/rate=(\d+)/.exec(inl.mimeType || "") || [])[1] || 24000);
    const bin = atob(inl.data), n = bin.length >> 1;
    const buf = aiCtx.createBuffer(1, n, rate), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v >= 32768) v -= 65536; ch[i] = v / 32768; }
    const src = aiCtx.createBufferSource(); src.buffer = buf; src.connect(aiCtx.destination);
    let ended = false;
    const end = () => { if (ended) return; ended = true; clearTimeout(guard); if (aiSrc === src) aiSrc = null; onEnd(); };
    const guard = setTimeout(end, buf.duration * 1000 + 1500);   // Sicherheitsnetz, falls „fertig“ nie kommt
    src.onended = end;
    src.stopGuard = () => { ended = true; clearTimeout(guard); };
    aiSrc = src; src.start(); onStart();
  }
  function aiSpeak(clean, ep, show, finish, fallback) {
    const pr = aiCache.get(clean) || gemTts(clean);
    aiCache.delete(clean);
    try { AND && AND.setSpeaking && AND.setSpeaking(true); } catch {}
    const done = () => { try { AND && AND.setSpeaking && AND.setSpeaking(false); } catch {} finish(); };
    pr.then(inl => {
      if (ep !== ttsEpoch) { done(); return; }
      playPcm(inl, show, done).catch(() => { try { AND && AND.setSpeaking && AND.setSpeaking(false); } catch {} fallback(); });
    }).catch(e => {
      if (ep !== ttsEpoch) return;
      try { AND && AND.setSpeaking && AND.setSpeaking(false); } catch {}
      aiBlockedUntil = Date.now() + 10 * 60000;   // 10 Minuten normale Stimme, dann neu versuchen
      note("KI-Stimme gerade nicht verfügbar (" + (e.message || e) + ") – ich nehme die normale Stimme.");
      fallback();
    });
  }
  function aiStop() {
    if (aiSrc) { const s = aiSrc; aiSrc = null; try { s.onended = null; s.stopGuard && s.stopGuard(); s.stop(); } catch {} try { AND && AND.setSpeaking && AND.setSpeaking(false); } catch {} }
    aiCache.clear();
  }

  // Menü: KI-Stimme wählen (Tippen wechselt: aus → Charon → Orus → … → aus) und kurz Probe sprechen
  function updateAiVoiceUi() {
    const em = $("cAiVoiceState"); if (!em) return;
    em.textContent = aiVoiceName ? aiVoiceName.toUpperCase() : "AUS";
    $("cAiVoice").classList.toggle("alert", !!aiVoiceName && !geminiKey);
  }
  if ($("cAiVoice")) {
    $("cAiVoice").onclick = () => {
      if (!geminiKey) { toast("Dafür brauchst du einen Gemini-Schlüssel (KI-Quelle)", "⚠", 4000); $("kSetup").hidden = false; return; }
      const i = AI_VOICES.indexOf(aiVoiceName);
      aiVoiceName = i < 0 ? AI_VOICES[0] : i + 1 < AI_VOICES.length ? AI_VOICES[i + 1] : "";
      lsSet("zg_ai_voice", aiVoiceName); aiBlockedUntil = 0; aiCache.clear();
      updateAiVoiceUi(); hush();
      if (aiVoiceName) {
        if (!ttsModelList().length) { toast("Gemini bietet für deinen Schlüssel gerade keine Stimme an", "⚠", 4000); return; }
        speak(`Hallo Damian, ich bin ${aiVoiceName}. So klinge ich als KI-Stimme.`);
      } else toast("KI-Stimme aus – normale Stimme", "🔊");
    };
    updateAiVoiceUi();
  }

  /* ================= Genaue KI-Erkennung (Android): Aufnahme → Gemini schreibt auf, was du gesagt hast =================
     Versteht Namen, Fachwörter und Nuscheln meist besser als die Handy-Erkennung. Dauert dafür etwa 1 Sekunde länger. */
  let aiEarOn = lsGet("zg_ai_ear") === "1", earBlockedUntil = 0;
  const aiEarUsable = () => aiEarOn && !!(AND && AND.recStart) && !!geminiKey && !!geminiModel && Date.now() > earBlockedUntil;
  class GemSR {
    constructor() { this.onresult = this.onerror = this.onend = null; this.sid = 0; this.aborted = false; }
    start() { GemSR.cur = this; this.sid = AND.recStart(pauseMs, 25000); }
    stop() { AND.recStop(this.sid); }
    abort() { this.aborted = true; AND.recAbort(this.sid); }
  }
  async function transcribe(wavB64) {
    const ab = AbortSignal.timeout(15000);
    const r = await gemFetch("generateContent", {
      contents: [{ role: "user", parts: [
        { inlineData: { mimeType: "audio/wav", data: wavB64 } },
        { text: "Schreib wortwörtlich auf, was in dieser Aufnahme gesagt wird (meist Deutsch). Nur der gesprochene Text, keine Erklärung, keine Anführungszeichen. Typische Wörter: Jarvis, Spotify, WhatsApp, Phantom Wallet, Alexa, SPS, Sparkasse, Tagebuch, Einkaufsliste. Wenn nichts Verständliches gesagt wird, antworte mit genau: -" },
      ] }],
      generationConfig: { temperature: 0 },
    }, ab);
    const j = await r.json();
    const t = ((((j.candidates || [])[0] || {}).content || {}).parts || []).filter(p => !p.thought).map(p => p.text || "").join("").trim();
    return t === "-" ? "" : t.replace(/^["„“]|["“”]$/g, "").trim();
  }
  window.__zgRec = {
    emit(ev) {
      const r = GemSR.cur; if (!r || ev.sid !== r.sid) return;
      if (ev.type === "speech") { input.placeholder = "Hört zu …"; return; }
      if (ev.type === "error") { GemSR.cur = null; r.onerror && r.onerror({ error: ev.info || "audio-capture" }); r.onend && r.onend(); return; }
      if (ev.type !== "end") return;
      GemSR.cur = null;
      if (r.aborted || ev.info !== "ok") { r.onerror && r.onerror({ error: ev.info === "no-speech" ? "no-speech" : "aborted" }); r.onend && r.onend(); return; }
      const wav = AND.recTake(r.sid);
      input.placeholder = "Versteht …";
      transcribe(wav).then(t => {
        input.placeholder = "Schreib Jarvis etwas …";
        if (r.aborted) { r.onerror && r.onerror({ error: "aborted" }); }
        else if (t) { const res = [{ transcript: t }]; res.isFinal = true; r.onresult && r.onresult({ results: [res] }); }
        else r.onerror && r.onerror({ error: "no-speech" });
        r.onend && r.onend();
      }).catch(e => {
        input.placeholder = "Schreib Jarvis etwas …";
        earBlockedUntil = Date.now() + 10 * 60000;   // 10 Minuten wieder die Handy-Erkennung
        note("Die KI-Erkennung hat gerade nicht geklappt – ich nehme wieder die Handy-Erkennung. Sag es bitte nochmal.");
        r.onerror && r.onerror({ error: "aborted" }); r.onend && r.onend();
      });
    },
  };
  if ($("cAiEar")) {
    if (AND && AND.recStart && !MINI) $("cAiEar").hidden = false;
    const earUi = () => { $("cAiEarState").textContent = aiEarOn ? "AN" : "AUS"; };
    earUi();
    $("cAiEar").onclick = () => {
      if (!aiEarOn && !geminiKey) { toast("Dafür brauchst du einen Gemini-Schlüssel (KI-Quelle)", "⚠", 4000); $("kSetup").hidden = false; return; }
      aiEarOn = !aiEarOn; lsSet("zg_ai_ear", aiEarOn ? "1" : "0"); earBlockedUntil = 0; earUi();
      toast(aiEarOn ? "Genaue KI-Erkennung an – Gemini schreibt mit" : "Handy-Erkennung (schneller)", "👂");
    };
  }
