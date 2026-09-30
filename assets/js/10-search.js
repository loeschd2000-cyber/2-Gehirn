  /* ---------- Gedächtnis-Suche: „Was hab ich über Lukas gesagt?“ ----------
     Durchsucht alle Gespräche, das Tagebuch und die gemerkten Dinge.
     Mit KI: kurze Antwort mit Datum. Ohne KI: die besten Fundstellen als Liste. */
  const SEARCH_RE = [
    /^\W*(?:(?:hey\s+)?jarvis\W*)?(?:was|wann|wo)\s+(?:hab|habe|hatte)\s+ich\s+(?:(?:denn|mal|schon|damals|je|jemals|letztens|zuletzt|dir|dir\s+mal|im\s+tagebuch|in\s+meinem\s+tagebuch)\s+)*(?:über|von|zu|wegen|zum\s+thema)\s+(.+?)\s+(?:gesagt|geredet|gesprochen|erzählt|geschrieben|gefragt|notiert|aufgeschrieben)\W*$/i,
    /\b(?:such\w*|find\w*|durchsuch\w*)\s+(?:mal\s+)?(?:in\s+|im\s+|durch\s+)?(?:meinen?\s+|meinem\s+|den\s+|dem\s+)?(?:chats?|gesprächen?|verlauf|tagebuch|notizen|nachrichten|erinnerungen|allem|gedächtnis)\s+(?:nach|über|zu)\s+(.+?)\W*$/i,
    /^\W*was\s+(?:stand|steht)\s+(?:in\s+meinem\s+|im\s+)tagebuch\s+(?:über|zu|von|wegen)\s+(.+?)\W*$/i,
    /^\W*wann\s+(?:hab|habe)\s+ich\s+(?:zuletzt\s+|das\s+letzte\s+mal\s+)?(?:über|von)\s+(.+?)\s+(?:geredet|gesprochen|erzählt|geschrieben)\W*$/i,
  ];
  const STOP = new Set("der die das den dem des ein eine einen einem einer und oder mit mein meine meinen meinem meiner ich du er sie es wir ihr mal was wie wo wann über von zu im in am an auf für bei nach vor".split(" "));

  function searchTerms(q) {
    return q.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/)
      .filter(w => w.length > 1 && !STOP.has(w))
      .map(w => w.length > 5 ? w.slice(0, Math.max(5, w.length - 2)) : w);   // „Führerscheins“ findet auch „Führerschein“
  }

  function searchAll(q) {
    const terms = searchTerms(q); if (!terms.length) return [];
    const hits = [];
    const score = t => { const l = t.toLowerCase(); let s = 0; for (const w of terms) if (l.includes(w)) s++; return s; };
    for (const c of chats) {
      if (!c || (c.hidden && !c.diary) || !Array.isArray(c.messages)) continue;
      for (let i = 0; i < c.messages.length; i++) {
        const m = c.messages[i]; if (!m || !m.content) continue;
        if (c.id === currentId && i >= c.messages.length - 2) continue;   // nicht die Frage selbst finden
        const s = score(m.content);
        if (!s) continue;
        hits.push({ s: s / terms.length + (c.diary ? 0.15 : 0) + (m.role === "user" ? 0.1 : 0), chat: c, m, ts: m.ts || c.updated || 0 });
      }
    }
    for (const f of dataGet("facts", [])) { const s = score(f.t); if (s) hits.push({ s: s / terms.length + 0.2, fact: true, m: { role: "user", content: f.t }, ts: f.ts || 0 }); }
    const need = terms.length > 2 ? 0.5 : 0.99;   // bei langen Suchen reicht die Hälfte der Wörter
    return hits.filter(h => h.s >= need).sort((a, b) => b.s - a.s || b.ts - a.ts).slice(0, 10);
  }

  function snippet(text, q) {
    const t = text.replace(/\s+/g, " ").trim(), terms = searchTerms(q), l = t.toLowerCase();
    let at = -1; for (const w of terms) { const i = l.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; }
    if (t.length <= 180) return t;
    const from = Math.max(0, at - 60);
    return (from > 0 ? "… " : "") + t.slice(from, from + 170).trim() + (from + 170 < t.length ? " …" : "");
  }
  const whenStr = ts => ts ? new Date(ts).toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short", year: new Date(ts).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }) : "";

  function searchCard(q, hits) {
    const card = document.createElement("div"); card.className = "card search";
    const b = document.createElement("b"); b.textContent = `🔎 „${q}“ · ${hits.length} Fundstelle${hits.length === 1 ? "" : "n"}`; card.append(b);
    for (const h of hits.slice(0, 6)) {
      const row = document.createElement("button"); row.type = "button"; row.className = "hit";
      const top = document.createElement("span"); top.className = "sub";
      top.textContent = (h.fact ? "🧠 Gemerkt" : h.chat.diary ? "📔 Tagebuch" : "💬 " + (h.chat.title || "Gespräch").slice(0, 40)) + (h.ts ? " · " + whenStr(h.ts) : "");
      const tx = document.createElement("span"); tx.className = "body"; tx.textContent = (h.m.role === "user" ? "Du: " : "Jarvis: ") + snippet(h.m.content, q);
      row.append(top, tx);
      if (h.chat) row.onclick = () => { hush(); openChat(h.chat); };
      else row.disabled = true;
      card.append(row);
    }
    log.append(card); log.scrollTop = log.scrollHeight;
  }

  async function handleSearch(text) {
    let q = null;
    for (const re of SEARCH_RE) { const m = re.exec(text); if (m) { q = m[1].trim(); break; } }
    if (!q) return false;
    q = q.replace(/^(?:den|die|das|dem|meinen?|meinem)\s+/i, "");
    const hits = searchAll(q);
    if (!hits.length) { assistantSay(`Dazu habe ich nichts gefunden – weder in unseren Gesprächen noch im Tagebuch. Über „${q}“ haben wir wohl noch nicht geredet.`); return true; }
    searchCard(q, hits);
    if (backend) {
      busy = true; refreshUi();
      try {
        const ctx = hits.map(h => `[${whenStr(h.ts) || "?"} · ${h.fact ? "gemerkt" : h.chat.diary ? "Tagebuch" : "Chat"} · ${h.m.role === "user" ? "Damian" : "Jarvis"}] ${snippet(h.m.content, q)}`).join("\n");
        const j = await llmJson(`Damian fragt: "${text.replace(/"/g, "'")}"\nHier sind die Fundstellen aus seinen alten Gesprächen, seinem Tagebuch und gemerkten Dingen:\n${ctx}\n\nBeantworte seine Frage kurz (höchstens 3 Sätze, Du-Form, zum Vorlesen geeignet) NUR mit diesen Fundstellen. Nenne das Datum, wenn es passt. Erfinde nichts. Wenn die Fundstellen die Frage nicht beantworten, sag das ehrlich.`,
          { type: "object", properties: { antwort: { type: "string" } }, required: ["antwort"] });
        busy = false; refreshUi();
        if (j && j.antwort) { assistantSay(j.antwort); return true; }
      } catch {}
      busy = false; refreshUi();
    }
    const h = hits[0];
    assistantSay(`Ich habe ${hits.length} Stelle${hits.length === 1 ? "" : "n"} gefunden. Die beste ist vom ${whenStr(h.ts) || "unbekannten Tag"}: ${snippet(h.m.content, q)}`);
    return true;
  }
