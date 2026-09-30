  /* ---------- PC steuern (nur wenn Jarvis über den PC-Server läuft: am PC oder übers Handy mit Tailscale) ----------
     „Mach am PC leiser“, „Nächstes Lied am PC“, „Öffne Spotify am PC“, „Sperr den PC“, „Fahr den PC in 30 Minuten herunter“ */
  let pcCtl = false, PC_BASE = "";
  async function pcPing() {
    if (!/^https?:$/.test(location.protocol)) return;
    try { const r = await fetchT(PC_BASE + "/pc/ping", { headers: { "X-ZG": "1" } }, 3000); pcCtl = r.ok && !!(await r.json()).ok; } catch { pcCtl = false; }
  }
  async function pcDo(action, arg) {
    const r = await fetchT(PC_BASE + "/pc/do", { method: "POST", headers: { "X-ZG": "1", "Content-Type": "application/json" }, body: JSON.stringify({ action, arg: String(arg == null ? "" : arg) }) }, 8000);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.msg || "PC antwortet nicht (" + r.status + ")");
    return j;
  }
  const PC_WORD = /\s*\b(?:am|auf\s+dem|beim|vom|im)\s+(?:pc|computer|laptop|rechner)\b|\s*\b(?:den|der|des|dem)\s+(?:pc|computer)\b|\s*\bpc\b/gi;
  const PC_APPS = [
    ["calc", /\b(?:taschenrechner|rechner-?app)\b/], ["notepad", /\b(?:editor|notepad|notizblock)\b/], ["explorer", /\b(?:explorer|datei-?explorer|dateien|ordner)\b/],
    ["chrome", /\bchrome\b/], ["browser", /\b(?:browser|edge|internet)\b/], ["spotify", /\bspotify\b/], ["discord", /\bdiscord\b/], ["steam", /\bsteam\b/],
    ["settings", /\beinstellungen\b/], ["taskmgr", /\btask-?manager\b/], ["youtube", /\byoutube\b/], ["whatsapp", /\bwhatsapp\b/], ["word", /\bword\b/],
    ["excel", /\bexcel\b/], ["outlook", /\boutlook\b/], ["teams", /\bteams\b/], ["code", /\b(?:vs\s*code|visual\s+studio\s+code)\b/], ["terminal", /\b(?:terminal|eingabeaufforderung|cmd|konsole)\b/],
    ["paint", /\bpaint\b/],
  ];
  async function handlePc(text) {
    const tl = clean(text).toLowerCase();
    const saysPc = new RegExp(PC_WORD.source, "i").test(tl);
    if (!pcCtl) {
      if (saysPc && /(?:^|\s)(öffne\w*|starte?\w*|leiser|lauter|stumm|sperr\w*|herunter|runter|ausschalt\w*|schalt\w*.*\baus|lautstärke|nächste\w*|pause|weiter)\b/.test(tl))
        { assistantSay("Den PC kann ich nur steuern, wenn Jarvis über den PC-Server läuft – also am PC selbst oder übers Handy mit Tailscale."); return true; }
      return false;
    }
    const t = tl.replace(new RegExp(PC_WORD.source, "gi"), " ").replace(/\s+/g, " ").trim();
    const E = "(?![\\wäöüß])";   // Wortende, das auch bei Umlauten stimmt
    const run = async (action, arg, msg) => {
      try { await pcDo(action, arg); lastViaVoice = false; assistantSay(msg, action === "media"); }
      catch (e) { assistantSay("Am PC hat das nicht geklappt: " + (e.message || e)); }
      return true;
    };
    // Herunterfahren abbrechen (geht immer, auch ohne „PC“ – genau so sagt es Jarvis vorher an)
    if (/^(?:das\s+)?(?:herunterfahren|ausschalten|shutdown)\s+(?:abbrechen|stopp\w*|stop)$|^(?:brich|breche?)\s+(?:das\s+)?(?:herunterfahren|ausschalten)\s+ab$/.test(t)) return run("abort", "", "Okay, der PC bleibt an.");
    const onPc = saysPc || !AND;   // am PC-Browser gehen Musik-/Programm-Befehle an den PC
    if (!onPc) return false;
    // Lautstärke auf X Prozent (nur wenn es wirklich um die Lautstärke geht)
    const vol = new RegExp("^(?:stell\\w*|setz\\w*|mach\\w*|dreh\\w*)?\\s*(?:die\\s+)?lautstärke\\s+(?:auf\\s+)?(\\d{1,3})\\s*(?:%|prozent)?$|^lautstärke\\s+(\\d{1,3})" + E).exec(t);
    if (vol) { const v = Math.min(100, +(vol[1] || vol[2])); return run("volume", v, `Lautstärke am PC: ${v} Prozent.`); }
    if (new RegExp("^(?:mach\\w*\\s+)?(?:(?:den\\s+)?ton\\s+)?(?:stumm|mute|unmute)" + E + "|^(?:ton|sound)\\s+(?:aus|an)$").test(t)) return run("mute", "", "Ton am PC umgeschaltet.");
    // Musik / Lautstärke per Medientasten
    const c = mediaCommand(t);
    if (c) return run("media", c.cmd, "PC: " + c.msg);
    // Alles Folgende nur, wenn „PC“ ausdrücklich gesagt wurde (sonst könnte „Wann ist Sperrmüll?“ den PC sperren)
    if (!saysPc) {
      const op0 = /^(?:öffne\w*|starte?\w*)\s+(?:mal\s+|bitte\s+|mir\s+)*(?:den\s+|die\s+|das\s+)?(.+?)$/.exec(t);
      const app0 = op0 && PC_APPS.find(([, re]) => re.test(op0[1]));
      if (app0 && !AND) return run("open", app0[0], `Ich öffne ${cap(op0[1])}.`);
      return false;
    }
    // Herunterfahren (mit Rückfrage): der PC muss gemeint sein
    const sd = new RegExp("(?:^|\\s)(?:fahr\\w*|schalt\\w*|mach\\w*)\\s+(?:(?:den|meinen|mein)\\s+)?(?:pc|computer|rechner|laptop)(?:\\s+\\S+)*?\\s+(?:herunter|runter|aus)" + E + "|(?:pc|computer|rechner|laptop)\\s+(?:herunterfahren|runterfahren|ausschalten|ausmachen)" + E).exec(tl);
    if (sd) {
      const m = /\bin\s+(\d+|einer|eine|einem|zwei|halben?)\s*(minuten?|min|stunden?|std)\b/.exec(t);
      let sec = 60;
      if (m) { const nWord = { einer: 1, eine: 1, einem: 1, zwei: 2, halben: 0.5, halbe: 0.5 }; const n = isNaN(+m[1]) ? (nWord[m[1]] || 1) : +m[1]; sec = Math.round(n * (/^st/.test(m[2]) ? 3600 : 60)); }
      if (/\bhalbe[n]?\s+stunde\b/.test(t)) sec = 1800;
      const when = sec < 90 ? "in einer Minute" : sec < 3600 ? `in ${Math.round(sec / 60)} Minuten` : `in ${(sec / 3600).toLocaleString("de-DE")} Stunde${sec === 3600 ? "" : "n"}`;
      makePending("pc", "🖥 PC herunterfahren", when, "Nicht gespeicherte Sachen am PC gehen verloren.", "Herunterfahren", "Abbrechen", { action: "shutdown", arg: sec, msg: `Okay, der PC fährt ${when} herunter. Sag „Herunterfahren abbrechen“, wenn du es dir anders überlegst.` });
      assistantSay(`Soll ich den PC ${when} herunterfahren?`);
      return true;
    }
    if (new RegExp("(?:^|\\s)(?:schlafen|ruhezustand|energiesparmodus|standby)" + E).test(t)) {
      makePending("pc", "🖥 PC schlafen legen", "sofort", "", "Schlafen legen", "Abbrechen", { action: "sleep", arg: "", msg: "Gute Nacht, PC." });
      assistantSay("Soll ich den PC jetzt schlafen legen?");
      return true;
    }
    if (new RegExp("^(?:sperr\\w*|sperre|abschließ\\w*|lock)(?:\\s+(?:ihn|es|bitte|mal))*$|^(?:mach\\w*\\s+)?(?:zu|dicht)$").test(t) || /(?:^|\s)(?:sperr\w*|abschließ\w*)\s*$/.test(t)) return run("lock", "", "Der PC ist gesperrt.");
    // Lautstärke (mit „PC“): „Stell am PC die Lautstärke auf 30“, „Mach den PC leiser“
    const vol2 = /lautstärke\D*(\d{1,3})/.exec(t);
    if (vol2) { const v = Math.min(100, +vol2[1]); return run("volume", v, `Lautstärke am PC: ${v} Prozent.`); }
    if (/(?:^|\s)(?:stumm|mute)(?![\wäöüß])|ton\s+(?:aus|an)$/.test(t)) return run("mute", "", "Ton am PC umgeschaltet.");
    // Programme öffnen
    const op = /(?:^|\s)(?:öffne\w*|starte?\w*|mach\w*|ruf\w*)\s+(?:mal\s+|bitte\s+|mir\s+)*(?:den\s+|die\s+|das\s+)?(.+?)(?:\s+(?:auf|an))?$/.exec(t);
    if (op) {
      const app = PC_APPS.find(([, re]) => re.test(op[1]));
      if (app) return run("open", app[0], `Ich öffne ${cap(op[1].replace(/\s+(?:bitte|mal)$/, ""))} am PC.`);
      if (saysPc) { assistantSay("Das Programm kenne ich noch nicht. Ich kann zum Beispiel Spotify, Chrome, Discord, Steam, Word, Excel, den Explorer oder den Rechner öffnen."); return true; }
    }
    return false;
  }
  function finishPc(p, ok) {
    if (!ok) { assistantSay("Okay, mache ich nicht."); return; }
    pcDo(p.action, p.arg).then(() => assistantSay(p.msg)).catch(e => assistantSay("Am PC hat das nicht geklappt: " + (e.message || e)));
  }
