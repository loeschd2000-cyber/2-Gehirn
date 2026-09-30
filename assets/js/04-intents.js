  /* ---------- Was will der Nutzer? ---------- */
  const ACTION_RE = /termin|kalender|eintrag|trag\b.*\bein\b|trage\b|erinner|verabred|was (hab|habe|hast|steht)|welche termine|hab ich (heute|morgen|am|nächste)|mail|posteingang|postfach|kontakt|nummer|telefon|adresse von|schreib\b.*\ban\b/i;
  function dayTable() {
    const now = new Date(); let t = "";
    for (let i = 0; i < 14; i++) { const d = new Date(now); d.setDate(now.getDate() + i); t += `${i === 0 ? "heute" : i === 1 ? "morgen" : i === 2 ? "übermorgen" : WD[d.getDay()]}: ${ymd(d)} (${WD[d.getDay()]})\n`; }
    return t;
  }
  async function extractAction(text) {
    const now = new Date();
    const prompt = `Heute ist ${WD[now.getDay()]}, der ${ymd(now)}, es ist ${pad(now.getHours())}:${pad(now.getMinutes())} Uhr.
Die nächsten Tage:
${dayTable()}
Ordne die Nachricht des Nutzers genau einer Aktion zu:
- "termin_erstellen": er will einen Termin eintragen oder an etwas erinnert werden. titel kurz (2 bis 5 Wörter, ohne Datum), datum JJJJ-MM-TT, uhrzeit HH:MM (leer, wenn keine genannt), dauer_minuten (Standard 60).
- "termine_anzeigen": er will wissen, welche Termine er hat. datum = erster Tag, bis_datum = letzter Tag ("diese Woche" = heute bis Sonntag).
- "mails_pruefen": er fragt nach neuen oder ungelesenen Mails.
- "mail_lesen": er will eine bestimmte Mail vorgelesen oder zusammengefasst haben. suchbegriff = Absender oder Thema (leer = neueste Mail).
- "mail_entwurf": er will jemandem eine Mail schreiben. name = Empfänger (Name oder E-Mail-Adresse), inhalt = worum es in der Mail gehen soll.
- "kontakt_suchen": er will Telefonnummer, E-Mail oder Adresse von jemandem wissen. name = die Person.
- "keine": alles andere.
Nachricht: "${text}"`;
    const schema = {
      type: "object",
      properties: {
        aktion: { type: "string", enum: ["termin_erstellen", "termine_anzeigen", "mails_pruefen", "mail_lesen", "mail_entwurf", "kontakt_suchen", "keine"] },
        titel: { type: "string" }, datum: { type: "string" }, uhrzeit: { type: "string" }, dauer_minuten: { type: "integer" }, bis_datum: { type: "string" },
        suchbegriff: { type: "string" }, name: { type: "string" }, inhalt: { type: "string" },
      },
      required: ["aktion"],
    };
    return llmJson(prompt, schema);
  }

  const YES = /^\s*(ja|jo|jep|jawohl|genau|klar|okay|ok|passt|mach( das)?|speicher\w*|trag( es)? ein|senden|schick\w*|bitte$|ja bitte)(?![\wäöüß])/i;
  const NO_START = /^\s*(nein|nee|ne|nö|abbrechen|stopp?|lass( es)?|verwerfen|lieber nicht|doch nicht)(?![\wäöüß])/i;
  // „bitte nicht“, „besser nicht“, „keine Lust“: nur bei kurzen Antworten als Nein werten (sonst „Ja, ich komme nicht“ = Nein)
  const NO = { test: t => NO_START.test(t) || (!YES.test(t) && t.trim().split(/\s+/).length <= 4 && /(?:^|\s)(nicht|kein\w*)(?![\wäöüß])/i.test(t)) };
