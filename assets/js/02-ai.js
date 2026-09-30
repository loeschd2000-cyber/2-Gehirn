  /* ================= KI-Motor: PC (Ollama) oder Gemini ================= */
  const AI_MODES = ["auto", "pc", "gemini"];
  let aiMode = AI_MODES.includes(lsGet("zg_ai_mode")) ? lsGet("zg_ai_mode") : "auto";
  let geminiKey = secGet("zg_gemini_key");
  let geminiModel = null, geminiCandidates = [], gemAllModels = [], pcOk = false, backend = null;   // backend: "pc" | "gemini" | null
  const GEM = "https://generativelanguage.googleapis.com/v1beta";

  async function checkPc() {
    try {
      const r = await fetch(OLLAMA + "/api/tags", { signal: AbortSignal.timeout(4000) });
      const names = ((await r.json()).models || []).map(m => m.name);
      pcOk = names.length > 0;
      if (pcOk) {
        const saved = lsGet("zg_pc_model");
        model = names.includes(saved) ? saved : names.includes(PREFERRED_MODEL) ? PREFERRED_MODEL : names[0];
        modelSel.textContent = "";
        for (const n of names) { const o = document.createElement("option"); o.value = o.textContent = n; modelSel.append(o); }
        modelSel.value = model;
      }
    } catch { pcOk = false; }
  }
  async function checkGemini() {
    if (!geminiKey) return false;
    if (geminiModel) return true;
    try {
      const r = await fetch(`${GEM}/models?pageSize=200`, { headers: { "x-goog-api-key": geminiKey } });
      if (!r.ok) throw new Error(r.status);
      const ms = ((await r.json()).models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent")).map(m => m.name);
      gemAllModels = ms;
      const ver = n => { const m = /gemini-(\d+(?:\.\d+)?)/.exec(n); return m ? parseFloat(m[1]) : 0; };
      // Reihenfolge: stabile Flash-Modelle (neueste zuerst), dann Vorschau-Versionen, dann Flash-Lite als Notlösung
      const bad = /image|tts|audio|live|embed|thinking|computer|robotics/;
      const pre = n => /preview|exp/.test(n) ? 1 : 0;
      const sortV = arr => arr.sort((a, b) => (pre(a) - pre(b)) || (ver(b) - ver(a)) || a.length - b.length);
      const flash = sortV(ms.filter(n => /flash/.test(n) && !/lite/.test(n) && !bad.test(n)));
      const lite = sortV(ms.filter(n => /flash-lite/.test(n) && !bad.test(n)));
      geminiCandidates = [...flash, ...lite];
      if (!geminiCandidates.length) geminiCandidates = ["models/gemini-flash-latest"];
      const remembered = lsGet("zg_gem_model");
      geminiModel = geminiCandidates.includes(remembered) ? remembered : geminiCandidates[0];
      return true;
    } catch { geminiModel = null; return false; }
  }
  async function checkAi() {
    await checkPc();
    const gemOk = await checkGemini();
    backend = aiMode === "pc" ? (pcOk ? "pc" : null)
            : aiMode === "gemini" ? (gemOk ? "gemini" : null)
            : (pcOk ? "pc" : gemOk ? "gemini" : null);
    ollamaOk = !!backend;
    modelSel.hidden = !(backend === "pc" && modelSel.options.length > 1);
    $("cAiState").textContent = aiMode === "auto" ? "AUTO" : aiMode === "pc" ? "PC" : "GEMINI";
    if (backend === "pc") { setDot("aiDot", "ok"); $("aiV").textContent = "PC (privat, ohne Limit) · " + model; }
    else if (backend === "gemini") { setDot("aiDot", "ok"); $("aiV").textContent = "Gemini (immer an) · " + geminiModel.replace("models/", ""); }
    else {
      setDot("aiDot", "bad");
      $("aiV").textContent = aiMode === "pc" ? "PC nicht erreichbar. Ist der PC an und läuft Ollama?"
        : !geminiKey ? (aiMode === "gemini" ? "Kein Gemini-Schlüssel. Tipp auf „KI-Quelle“." : "PC nicht erreichbar und kein Gemini-Schlüssel. Tipp auf „KI-Quelle“.")
        : "Gemini nicht erreichbar. Schlüssel prüfen oder Internet?";
    }
    setDot("sysDot", backend ? "ok" : "warn");
    $("sysText").textContent = backend ? "System bereit" : "KI fehlt";
    return backend;
  }
  async function warmUp() {
    if (backend !== "pc" || !model) return;
    const m = model;
    try {
      await fetch(OLLAMA + "/api/generate", { method: "POST", body: JSON.stringify({ model: m, keep_alive: "60m", options: { num_ctx: 2048 } }) });
      if (model === m && backend === "pc") $("aiV").textContent = "PC (privat, ohne Limit) · " + m + " (geladen)";
    } catch {}
  }
  $("cAi").onclick = async () => {
    aiMode = AI_MODES[(AI_MODES.indexOf(aiMode) + 1) % AI_MODES.length];
    lsSet("zg_ai_mode", aiMode);
    if (aiMode === "gemini" && !geminiKey) { $("kSetup").hidden = false; $("kId").focus(); }
    await checkAi(); warmUp();
  };
  $("aiV").addEventListener("click", () => { if (!geminiKey || !backend) { $("kSetup").hidden = false; } });
  $("kCancel").onclick = () => { $("kSetup").hidden = true; };
  $("kSave").onclick = async () => {
    const k = $("kId").value.trim();
    if (k.length < 20) { note("Das sieht nicht wie ein Gemini-Schlüssel aus."); return; }
    geminiKey = k; geminiModel = null; secSet("zg_gemini_key", k); $("kId").value = "";
    $("kSetup").hidden = true;
    const b = await checkAi();
    note(geminiModel ? "Gemini ist eingerichtet." + (b === "pc" ? " Solange der PC erreichbar ist, nutzt „AUTO“ den PC. Für Gemini auf „KI-Quelle“ tippen." : "") : "Mit diesem Schlüssel klappt es nicht. Bitte prüfen.");
  };

  // Nachrichten ins Gemini-Format bringen (system -> systemInstruction, assistant -> model)
  function toGemini(msgs) {
    const sys = msgs.filter(m => m.role === "system").map(m => m.content).join("\n\n");
    const contents = [];
    for (const m of msgs) {
      if (m.role === "system") continue;
      const role = m.role === "assistant" ? "model" : "user";
      const last = contents[contents.length - 1];
      if (last && last.role === role) last.parts[0].text += "\n\n" + m.content;
      else contents.push({ role, parts: [{ text: m.content }] });
    }
    while (contents.length && contents[0].role !== "user") contents.shift();
    const body = { contents };
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    return body;
  }
  async function gemFetchOne(modelName, path, body, signal) {
    const url = `${GEM}/${modelName}:${path}`;
    const headers = { "Content-Type": "application/json", "x-goog-api-key": geminiKey };
    // zuerst mit wenig "Nachdenken" (schneller), falls das Modell das nicht kennt: ohne
    const withThink = { ...body, generationConfig: { ...(body.generationConfig || {}), thinkingConfig: { thinkingLevel: "low" } } };
    let r = await fetch(url, { method: "POST", signal, headers, body: JSON.stringify(withThink) });
    if (r.status === 400) {
      const t = await r.clone().text();
      if (/thinking/i.test(t)) r = await fetch(url, { method: "POST", signal, headers, body: JSON.stringify(body) });
    }
    return r;
  }
  // Probiert das aktuelle Modell; ist es überlastet oder das Limit erreicht, automatisch das nächste
  async function gemFetch(path, body, signal) {
    const order = [geminiModel, ...geminiCandidates.filter(m => m !== geminiModel)];
    let lastStatus = 0, lastText = "";
    for (let i = 0; i < order.length && i < 8; i++) {
      const m = order[i];
      const r = await gemFetchOne(m, path, body, signal);
      if (r.ok) {
        if (m !== geminiModel || lsGet("zg_gem_model") !== m) { geminiModel = m; lsSet("zg_gem_model", m); if (backend === "gemini") $("aiV").textContent = "Gemini (immer an) · " + m.replace("models/", ""); }
        return r;
      }
      lastStatus = r.status; lastText = await r.text();
      // Modell abgeschaltet („no longer available“ …)? Aus der Liste streichen und ein neueres nehmen
      if (/no longer available|not found|deprecated|not supported|update your code|is not available/i.test(lastText)) {
        geminiCandidates = geminiCandidates.filter(x => x !== m);
        if (lsGet("zg_gem_model") === m) lsSet("zg_gem_model", "");
        const hint = /models\/(gemini-[\w.-]+)/.exec(lastText.replace(m, ""));
        if (hint && !order.includes("models/" + hint[1])) order.splice(i + 1, 0, "models/" + hint[1]);
        if (geminiModel === m) geminiModel = order[i + 1] || null;
        continue;
      }
      const overloaded = r.status === 503 || r.status === 500 || r.status === 429 || r.status === 404 || /high demand|overloaded|unavailable/i.test(lastText);
      if (!overloaded) break;
    }
    throw new Error(gemError(lastStatus, lastText));
  }
  function gemError(status, text) {
    if (/high demand|overloaded|unavailable/i.test(text) || status === 503) return "Gemini ist gerade überlastet (alle Modelle). Versuch es in ein paar Minuten nochmal oder stell „KI-Quelle“ auf PC.";
    if (status === 429) return "Das kostenlose Gemini-Limit ist gerade erreicht. Später nochmal oder auf die PC-KI umschalten.";
    if (status === 400 && /API key/i.test(text)) return "Der Gemini-Schlüssel ist ungültig.";
    if (status === 403) return "Gemini lehnt den Schlüssel ab (403).";
    try { return JSON.parse(text).error.message; } catch { return "Gemini-Fehler " + status; }
  }

  // Antwort Stück für Stück holen; onPiece bekommt jeweils den neuen Text
  async function llmStream(msgs, onPiece, signal) {
    if (backend === "gemini") {
      const r = await gemFetch("streamGenerateContent?alt=sse", { ...toGemini(msgs), generationConfig: { temperature: 0.7, maxOutputTokens: 1024 } }, signal);
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const j = JSON.parse(line.slice(5));
          const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
          const piece = parts.filter(p => !p.thought).map(p => p.text || "").join("");
          if (piece) onPiece(piece);
        }
      }
      return;
    }
    const r = await fetch(OLLAMA + "/api/chat", {
      method: "POST", signal,
      body: JSON.stringify({ model, stream: true, keep_alive: "60m", options: { num_ctx: 2048 }, messages: msgs }),
    });
    if (!r.ok) throw new Error((await r.text()) || ("Fehler " + r.status));
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const j = JSON.parse(line);
        if (j.error) throw new Error(j.error);
        const piece = j.message && j.message.content || "";
        if (piece) onPiece(piece);
      }
    }
  }
  // Antwort als JSON (für Termine, Mails usw.)
  // Abbrechbar (Mikrofon-Knopf „Stopp“) und mit Zeitlimit, damit nichts ewig hängt
  function abortable(ms) {
    const c = new AbortController(); ctl = c;
    const sig = AbortSignal.any && AbortSignal.timeout ? AbortSignal.any([c.signal, AbortSignal.timeout(ms)]) : c.signal;
    return { sig, done: () => { if (ctl === c) ctl = null; } };
  }
  async function llmJson(prompt, schema) {
    const ab = abortable(45000);
    try { return await llmJsonInner(prompt, schema, ab.sig); } finally { ab.done(); }
  }
  async function llmJsonInner(prompt, schema, signal) {
    if (backend === "gemini") {
      const r = await gemFetch("generateContent", {
        contents: [{ role: "user", parts: [{ text: prompt + "\n\nAntworte nur mit einem JSON-Objekt nach diesem Schema, ohne weiteren Text:\n" + JSON.stringify(schema) }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      }, signal);
      const j = await r.json();
      const txt = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).filter(p => !p.thought).map(p => p.text || "").join("");
      const m = /\{[\s\S]*\}/.exec(txt);
      return JSON.parse(m ? m[0] : txt);
    }
    const r = await fetch(OLLAMA + "/api/chat", {
      method: "POST", signal,
      body: JSON.stringify({ model, stream: false, format: schema, keep_alive: "60m", options: { num_ctx: 2048, temperature: 0 }, messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) throw new Error(await r.text());
    return JSON.parse((await r.json()).message.content);
  }

  // Eine KI-Antwort erzeugen, gleichzeitig vorlesen und speichern
  async function streamReply(modelMessages) {
    const bubble = add("msg ai wait", "Denkt nach …");
    bubbleEl = bubble; shown = ""; fullAnswer = "";
    busy = true; spokenUpTo = 0; genDone = false; refreshUi();
    const saving = persist();
    ctl = new AbortController();
    let full = "";
    try {
      await llmStream(modelMessages, piece => {
        full += piece; fullAnswer = full;
        if (!voiceActive()) { bubble.classList.remove("wait"); bubble.textContent = full; log.scrollTop = log.scrollHeight; }
        genDone = false; pump();
      }, ctl.signal);
      genDone = true; pump();
    } catch (e) {
      if (e && e.name === "AbortError") { lastViaVoice = false; }
      else { lastViaVoice = false; note("Die KI hat einen Fehler gemeldet: " + (e && e.message || e)); }
      if (!full) bubble.remove(); else revealAll();
    }
    await saving;
    if (full.trim()) { messages.push({ role: "assistant", content: full.trim(), ts: Date.now() }); await persist(); }
    ctl = null; busy = false; refreshUi();
    if (!speaking) { revealAll(); maybeListenAgain(); scheduleWake(700); }
  }

  // Eine feste Antwort (ohne KI) sprechen, anzeigen und speichern
  function assistantSay(text, silent) {
    const b = add("msg ai wait", "…");
    bubbleEl = b; shown = ""; fullAnswer = text; spokenUpTo = 0; genDone = true;
    if (voiceActive() && !silent) pump(); else revealAll();
    messages.push({ role: "assistant", content: text, ts: Date.now() });
    persist();
  }

  let askGen = 0;
  async function ask(text, viaVoice) {
    askGen++;
    if (!backend) await checkAi();
    lastViaVoice = viaVoice;
    hush();
    add("msg me", text);
    messages.push({ role: "user", content: text, ts: Date.now() });
    // Befehle wie Musik, Anrufen, Wecker, Wallet klappen auch ohne KI
    if (await handleActions(text)) { if (!speaking && !busy) { maybeListenAgain(); scheduleWake(700); } return; }
    // freie Sätze: KI übersetzt in bekannte Befehle (auch mehrere auf einmal)
    if (await handleAgent(text)) { if (!speaking && !busy) { maybeListenAgain(); scheduleWake(700); } return; }
    if (!backend) { note("Keine KI erreichbar. Tipp links auf „KI-Quelle“ oder starte den PC."); return; }
    const ctx = messages.slice(-10).map(m => ({ role: m.role, content: m.content }));
    await streamReply([{ role: "system", content: RULES() }, ...ctx]);
  }

  $("form").addEventListener("submit", e => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t || busy) return;
    input.value = ""; ask(t, false);
  });
  input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("form").requestSubmit(); } });
