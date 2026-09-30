  /* ---------- Wecker (nur Android-App): „Stell einen Wecker bei der Alexa um 5 Uhr“ ---------- */
  const NUMW = { ein:1, eins:1, eine:1, zwei:2, drei:3, vier:4, fünf:5, sechs:6, sieben:7, acht:8, neun:9, zehn:10, elf:11, zwölf:12 };
  const numOf = w => { if (w == null) return NaN; const n = parseInt(w, 10); return isNaN(n) ? (NUMW[w.toLowerCase()] ?? NaN) : n; };
  const TAGE = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
  /** Liest aus dem Satz die Weckzeit. Rückgabe: { at: Date, h, m, dayWord } oder null */
  function parseAlarmTime(text, now = new Date()) {
    const t = text.toLowerCase().replace(/[.!?]+$/, "");
    const N = "(\\d{1,2}|ein|eins|eine|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)";
    let rel = /\bin\s+(\d{1,3}|einer|einem|eine|zwei|drei|fünf|zehn|zwanzig|dreißig)\s+(minuten?|stunden?)\b/.exec(t);
    if (rel) {
      const map = { einer:1, einem:1, eine:1, zwanzig:20, "dreißig":30 };
      const n = parseInt(rel[1], 10) || map[rel[1]] || NUMW[rel[1]] || 0;
      if (!n) return null;
      const at = new Date(now.getTime() + n * (rel[2].startsWith("stunde") ? 3600000 : 60000));
      at.setSeconds(0, 0);
      return { at, h: at.getHours(), m: at.getMinutes(), dayWord: "", rel: true };
    }
    let h = NaN, m = 0, x;
    if ((x = new RegExp("\\bhalb\\s+" + N + "\\b").exec(t))) { h = numOf(x[1]) - 1; m = 30; }
    else if ((x = new RegExp("\\bviertel\\s+nach\\s+" + N + "\\b").exec(t))) { h = numOf(x[1]); m = 15; }
    else if ((x = new RegExp("\\bviertel\\s+vor\\s+" + N + "\\b").exec(t))) { h = numOf(x[1]) - 1; m = 45; }
    else if ((x = /\b(\d{1,2})[:.](\d{2})\b/.exec(t))) { h = +x[1]; m = +x[2]; }
    else if ((x = new RegExp("\\b" + N + "\\s*uhr(?:\\s+(\\d{1,2}))?\\b").exec(t))) { h = numOf(x[1]); m = x[2] ? +x[2] : 0; }
    else if ((x = new RegExp("\\bum\\s+" + N + "\\b").exec(t))) { h = numOf(x[1]); }
    if (isNaN(h)) return null;
    if (h === -1) h = 23;
    if (/\b(abends?|nachmittags?|nachts?)\b/.test(t) && h < 12 && !(/nachts?/.test(t) && h < 5)) h += 12;
    if (/\bnachts?\b/.test(t) && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
    const at = new Date(now); at.setHours(h, m, 0, 0);
    let dayWord = "";
    if (/(?:^|\s)übermorgen\b/.test(t)) { at.setDate(at.getDate() + 2); dayWord = "übermorgen"; }
    else if (/\bmorgen\b/.test(t)) { at.setDate(at.getDate() + 1); dayWord = "morgen"; }
    else {
      const d = TAGE.findIndex(w => new RegExp("\\b(?:am\\s+)?" + w + "\\b").test(t));
      if (d >= 0) {
        let add = (d - now.getDay() + 7) % 7;
        if (add === 0 && at <= now) add = 7;
        at.setDate(at.getDate() + add); dayWord = "am " + TAGE[d][0].toUpperCase() + TAGE[d].slice(1);
      } else if (at <= now) at.setDate(at.getDate() + 1);
    }
    if (at <= now) return null;
    if (!dayWord) {
      const diff = Math.round((new Date(at).setHours(0,0,0,0) - new Date(now).setHours(0,0,0,0)) / 86400000);
      dayWord = diff === 0 ? "heute" : diff === 1 ? "morgen" : "";
    }
    return { at, h, m, dayWord };
  }
  const zeitText = (h, m) => m ? `${h}:${String(m).padStart(2, "0")} Uhr` : `${h} Uhr`;

  function handleAlarm(text) {
    const t = text.trim();
    if (!/\b(wecker|weckzeit|weck(?:e)?\s+mich)\b/i.test(t)) return false;
    const alexa = /\b(alexa|echo)\b/i.test(t);
    if (!AND) { assistantSay("Wecker stellen geht nur in der Android-App auf deinem Handy."); return true; }
    const has = n => typeof AND[n] === "function";
    // Wecker löschen
    if (/\b(lösch\w*|entfern\w*|abbrech\w*|brich|streich\w*|stornier\w*|deaktivier\w*|mach\w*\s+.*\baus|ausschalten)\b/i.test(t)) {
      if (!has("alexaCancel")) { assistantSay("Dafür brauchst du die neueste Version der App."); return true; }
      let list = []; try { list = JSON.parse(AND.alexaAlarms()); } catch {}
      if (!list.length) { assistantSay(alexa ? "Es ist kein Alexa-Wecker gestellt." : "Es ist kein Alexa-Wecker gestellt. Wecker in deiner Uhr-App löschst du bitte dort."); return true; }
      AND.alexaCancel(-1);
      assistantSay(list.length === 1 ? "Der Alexa-Wecker ist gelöscht." : `Alle ${list.length} Alexa-Wecker sind gelöscht.`);
      return true;
    }
    // Welche Wecker sind gestellt?
    if (/\b(welche[rn]?|zeig\w*|liste|hab\s+ich|sind|ist)\b.*\bwecker\b/i.test(t) && !/\b(stell|setz|mach|erstell|weck)\w*\b/i.test(t)) {
      let list = []; try { list = JSON.parse(AND.alexaAlarms()); } catch {}
      if (!list.length) { assistantSay("Es ist gerade kein Alexa-Wecker gestellt."); return true; }
      const parts = list.sort((a, b) => a.at - b.at).map(a => { const d = new Date(a.at); return d.toLocaleDateString("de-DE", { weekday: "long" }) + " um " + zeitText(d.getHours(), d.getMinutes()); });
      assistantSay("Alexa-Wecker gestellt für: " + parts.join(", ") + ".");
      return true;
    }
    const when = parseAlarmTime(t);
    if (!when) { assistantSay("Um wie viel Uhr soll der Wecker klingeln? Sag zum Beispiel: stell einen Wecker um 5 Uhr."); return true; }
    const wann = (when.dayWord ? when.dayWord + " um " : "um ") + zeitText(when.h, when.m);
    // Ist die Alexa verbunden, stellt „Wecker um 6“ BEIDE: Alexa + Handy. „nur Handy“ / „nur Alexa“ geht auch.
    const onlyPhone = /\bnur\s+(?:am\s+|auf\s+dem\s+|mein(?:em)?\s+)?handy\b/i.test(t);
    const onlyAlexa = /\bnur\s+(?:die\s+|der\s+|auf\s+der\s+|bei\s+der\s+)?alexa\b/i.test(t);
    const alexaOk = has("alexaReady") && AND.alexaReady();
    if (!onlyPhone && (alexa || alexaOk) && alexaOk && has("phoneAlarm")) {
      AND.alexaAlarm(String(when.at.getTime()), "Jarvis Wecker");
      const far = when.at.getTime() - Date.now() > 24 * 3600000;
      if (!onlyAlexa && !far) AND.phoneAlarm(when.h, when.m, "Jarvis");
      assistantSay(onlyAlexa ? `Alexa-Wecker für ${wann} ist gestellt.`
        : far ? `Alexa-Wecker für ${wann} ist gestellt. Den Handy-Wecker kann ich nur für die nächsten 24 Stunden stellen, sag es mir am Vortag nochmal.`
        : `Alexa-Wecker und Handy-Wecker für ${wann} sind gestellt.`);
      return true;
    }
    if (alexa && !onlyPhone) {
      if (!has("alexaAlarm")) { assistantSay("Dafür brauchst du die neueste Version der App. Lade sie bitte neu herunter."); return true; }
      if (!AND.alexaReady()) {
        assistantSay("Die Alexa ist noch nicht verbunden. Trag bitte in den App-Einstellungen deinen Voice-Monkey-Schlüssel ein. Ich öffne sie dir.");
        setTimeout(() => { try { AND.openSetup(); } catch {} }, 3500);
        return true;
      }
      AND.alexaAlarm(String(when.at.getTime()), "Jarvis Wecker");
      assistantSay(`Alexa-Wecker für ${wann} ist gestellt.`);
      return true;
    }
    if (!has("phoneAlarm")) { assistantSay("Dafür brauchst du die neueste Version der App."); return true; }
    AND.phoneAlarm(when.h, when.m, "Jarvis");
    const far = when.at.getTime() - Date.now() > 24 * 3600000;
    assistantSay(far ? `Ich habe den Wecker in deiner Uhr-App auf ${zeitText(when.h, when.m)} gestellt. Er klingelt beim nächsten Mal um diese Uhrzeit, nicht erst ${when.dayWord}.`
                     : `Wecker für ${wann} ist gestellt.`);
    return true;
  }
