  /* ---------- Tagebuch: „Tagebuch“ → erzählen → „fertig“ → Jarvis schreibt es sauber auf ---------- */
  let diaryMode = false, diaryParts = [], diaryPrevPause = null;
  const DIARY_START = /\btagebuch\b.*\b(schreib\w*|neu\w*|eintrag|start\w*|will|möchte|lass|beginn\w*|machen|führen|aufnehmen|erzähl\w*)\b|^(?:(?:hey\s+)?jarvis\W*)?(?:mein\s+|neues?\s+)?tagebuch\W*$|\b(schreib|nimm)\s+(?:mal\s+)?(?:in\s+)?(?:mein|das)\s+tagebuch\b/i;
  const DIARY_READ = /\btagebuch\b.*\b(lies|lese|vorlesen|vor|was\s+(?:hab|habe|steht|stand)|zeig\w*)\b|\b(lies|was\s+hab\w*\s+ich)\b.*\btagebuch\b/i;
  const DIARY_END = /^\W*(fertig|ende|das\s+war'?s|das\s+wars|schluss|speicher\w*|stopp?|tagebuch\s+(?:beenden|fertig|ende|speichern|zu))\W*(?:bitte|jarvis)?\W*$|\btagebuch\s+(?:beenden|speichern)\b/i;
  const DIARY_CANCEL = /^\W*(abbrechen|verwerfen|lösch\w*\s+das|vergiss\s+es)\W*$/i;
  const DIARY_REMIND = /\b(erinner\w*)\b.*\btagebuch\b|\btagebuch\b.*\berinnerung\b/i;
  const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const diaryId = d => "diary-" + dayKey(d);
  window.__zgDiary = () => { if (!diaryMode) startDiary(true); return true; };

  function startDiary(fromReminder) {
    diaryMode = true; diaryParts = [];
    if (diaryPrevPause === null) { diaryPrevPause = pauseMs; pauseMs = 4000; }   // beim Erzählen längere Pausen erlauben
    const n = new Date();
    assistantSay((fromReminder ? "Schön, dass du da bist. " : "") + `Tagebuch für ${n.toLocaleDateString("de-DE", { weekday: "long" })} ist offen. Erzähl mir von deinem Tag, ich schreibe mit. Sag „fertig“, wenn du fertig bist.`);
    lastViaVoice = true;
    const go = () => { if (speaking) { setTimeout(go, 250); return; } if (diaryMode && !listening && !busy) listen(); };
    setTimeout(go, 600);
    document.body.classList.add("diary");
  }
  function stopDiaryMode() {
    diaryMode = false; document.body.classList.remove("diary");
    if (diaryPrevPause !== null) { pauseMs = diaryPrevPause; diaryPrevPause = null; }
  }
  async function finishDiary() {
    const raw = diaryParts.join(" ").trim();
    stopDiaryMode();
    if (!raw) { assistantSay("Du hast noch nichts erzählt, also habe ich nichts gespeichert."); return; }
    busy = true; refreshUi();
    let entry = { titel: "", text: raw, stimmung: "" };
    try {
      if (backend) {
        const j = await llmJson(`Das hier hat Damian abends seinem Tagebuch erzählt (gesprochen, deshalb evtl. holprig):\n"""${raw}"""\n\nSchreibe daraus einen sauberen Tagebucheintrag in der Ich-Form, so wie Damian ihn selbst schreiben würde. Behalte ALLE Inhalte, Namen und Gefühle, erfinde nichts dazu, lass nichts weg. Korrigiere nur Grammatik und Satzbau, teile in Absätze. Gib außerdem einen kurzen Titel (max. 6 Wörter) und die Stimmung als ein Emoji plus ein Wort (z. B. „😊 gut“). Antworte als JSON mit titel, text, stimmung.`,
          { type: "object", properties: { titel: { type: "string" }, text: { type: "string" }, stimmung: { type: "string" } }, required: ["titel", "text", "stimmung"] });
        if (j && j.text && j.text.length > raw.length * 0.4) entry = j;
      }
    } catch {}
    busy = false; refreshUi();
    const now = new Date(), id = diaryId(now);
    let c = chats.find(x => x.id === id);
    const title = `📔 Tagebuch · ${now.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}`;
    if (!c) { c = { id, title, created: now.getTime(), updated: now.getTime(), messages: [], diary: true }; chats.push(c); }
    const ts = now.getTime();
    c.messages.push({ role: "user", content: raw, ts }, { role: "assistant", content: (entry.titel ? entry.titel + (entry.stimmung ? "  ·  " + entry.stimmung : "") + "\n\n" : "") + entry.text, ts: ts + 1 });
    c.updated = ts;
    saveLocal(); renderAll(); scheduleDriveSave(); uploadChat(c);
    const card = document.createElement("div"); card.className = "card";
    const b = document.createElement("b"); b.textContent = "📔 " + (entry.titel || "Tagebuch") + (entry.stimmung ? "  ·  " + entry.stimmung : ""); card.append(b);
    const sub = document.createElement("span"); sub.className = "sub"; sub.textContent = now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" }); card.append(sub);
    const body = document.createElement("div"); body.className = "body"; body.textContent = entry.text; card.append(body);
    log.append(card); log.scrollTop = log.scrollHeight;
    lastViaVoice = false;
    try { renderTiles(); } catch {}
    const cal = await markDiaryInCalendar(c, entry);
    if (cal !== "ok" && cal !== "nicht verbunden") note("Kalender: " + cal);
    assistantSay("Gespeichert. Dein Tagebucheintrag für heute ist aufgeschrieben" + (cal === "ok" ? " und im Kalender abgehakt." : ".") + (entry.stimmung ? " Stimmung: " + entry.stimmung.replace(/^\S+\s*/, "") + "." : ""));
  }
  /** Im Google Kalender abhaken: ganztägiger grüner Termin „✅ Tagebuch geschrieben“ (einmal pro Tag) */
  async function markDiaryInCalendar(c, entry) {
    try { await getToken(true); } catch { return "nicht verbunden"; }
    const d = new Date(), next = new Date(d); next.setDate(d.getDate() + 1);
    const desc = (entry.titel ? entry.titel + (entry.stimmung ? " · " + entry.stimmung : "") + "\n\n" : "") + "Eingetragen von Jarvis (Zweites Gehirn).";
    const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
    try {
      if (c.calEventId) {
        await gApi(`${base}/${encodeURIComponent(c.calEventId)}`, { method: "PATCH", body: JSON.stringify({ description: desc }) });
      } else {
        const ev = await gApi(base, { method: "POST", body: JSON.stringify({
          summary: "✅ Tagebuch geschrieben" + (entry.stimmung ? " " + entry.stimmung.split(/\s+/)[0] : ""),
          description: desc, start: { date: dayKey(d) }, end: { date: dayKey(next) },
          transparency: "transparent", colorId: "10", reminders: { useDefault: false, overrides: [] } }) });
        c.calEventId = ev && ev.id; saveLocal(); scheduleDriveSave(); uploadChat(c);
      }
      return "ok";
    } catch (e) { return e.message || "Fehler"; }
  }
  function diaryDateFrom(t) {
    const d = new Date(); d.setHours(12, 0, 0, 0);
    if (/vorgestern/.test(t)) { d.setDate(d.getDate() - 2); return d; }
    if (/gestern/.test(t)) { d.setDate(d.getDate() - 1); return d; }
    const wd = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"].findIndex(w => t.includes(w));
    if (wd >= 0) { let back = (d.getDay() - wd + 7) % 7; if (back === 0 && !/heute/.test(t)) back = 7; d.setDate(d.getDate() - back); return d; }
    const m = /\b(\d{1,2})\.\s*(\d{1,2})?\.?/.exec(t);
    if (m) { d.setMonth(m[2] ? +m[2] - 1 : d.getMonth(), +m[1]); if (dayKey(d) > dayKey(new Date())) d.setFullYear(d.getFullYear() - 1); return d; }
    return d;   // heute
  }
  async function handleDiary(text) {
    const t = text.toLowerCase();
    if (diaryMode) {
      if (DIARY_CANCEL.test(t)) { stopDiaryMode(); diaryParts = []; lastViaVoice = false; assistantSay("Okay, verworfen. Nichts gespeichert."); return true; }
      if (DIARY_END.test(t)) { await finishDiary(); return true; }
      diaryParts.push(text.trim());
      // leise weiter zuhören, nicht dazwischenreden
      lastViaVoice = true;
      setTimeout(() => { if (diaryMode && !listening && !busy && !speaking) listen(); }, 300);
      return true;
    }
    if (DIARY_REMIND.test(t)) {
      if (!AND || !AND.diaryReminder) { assistantSay("Die Erinnerung geht nur in der Android-App."); return true; }
      if (/\b(aus|stopp|nicht\s+mehr|keine)\b/.test(t)) { AND.diaryReminder(-1, -1); assistantSay("Die Tagebuch-Erinnerung ist aus."); return true; }
      const w = parseAlarmTime(t);
      const h = w ? w.h : 21, m = w ? w.m : 30;
      AND.diaryReminder(h, m);
      assistantSay(`Alles klar. Ich erinnere dich jeden Abend um ${zeitText(h, m)} an dein Tagebuch.`);
      return true;
    }
    if (DIARY_READ.test(t)) {
      const d = diaryDateFrom(t), c = chats.find(x => x.id === diaryId(d));
      const when = dayKey(d) === dayKey(new Date()) ? "heute" : d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
      if (!c) {
        const all = chats.filter(x => x.diary || /^diary-/.test(x.id)).sort((a, b) => b.updated - a.updated);
        assistantSay(`Für ${when} habe ich keinen Tagebucheintrag.` + (all.length ? ` Du hast insgesamt ${all.length} Einträge, der letzte ist vom ${new Date(all[0].created).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}.` : ""));
        return true;
      }
      const texts = c.messages.filter(m => m.role === "assistant").map(m => m.content);
      assistantSay(`Dein Tagebuch von ${when}: ` + texts.join(" ").replace(/\s+·\s+\S+\s+\S+\n/g, ". "));
      return true;
    }
    if (DIARY_START.test(t)) { startDiary(false); return true; }
    return false;
  }
