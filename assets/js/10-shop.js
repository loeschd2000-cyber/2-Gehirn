  /* ================= Amazon-Warenkorb, Preis-Wächter, Verkaufs-Helfer, Spar-Coach, Job-Finder ================= */

  // Gemini mit Google-Suche (aktuelle Infos aus dem Internet)
  async function gemSearch(prompt, ms = 45000) {
    if (!geminiKey) throw new Error("kein-key");
    if (!geminiModel) await checkGemini();
    const ab = abortable(ms);
    try {
      const r = await gemFetch("generateContent", { contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }, ab.sig);
      const j = await r.json();
      const c = (j.candidates || [])[0] || {};
      const text = ((c.content || {}).parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
      const links = (((c.groundingMetadata || {}).groundingChunks) || []).map(g => g.web).filter(Boolean);
      return { text, links };
    } finally { ab.done(); }
  }
  const jsonIn = t => { const m = /\{[\s\S]*\}/.exec(t || ""); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };
  const euroTxt = v => (typeof v === "number" && isFinite(v)) ? v.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €" : "";
  const parseEuro = s => { const m = /(\d{1,6}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:\.\d{1,2})?)/.exec(String(s || "")); if (!m) return NaN; const x = m[1]; return x.includes(",") ? +x.replace(/\./g, "").replace(",", ".") : +x; };
  const AMZ_NUM = { ein: 1, eine: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, zehn: 10 };
  function busyBubble(t) { const b = add("msg ai wait", t); busy = true; refreshUi(); return () => { b.remove(); busy = false; refreshUi(); }; }
  function openUrl(url, pkg) {
    if (!/^https:\/\//.test(url)) return;
    if (AND && AND.openLink) AND.openLink(url, pkg || ""); else window.open(url, "_blank", "noopener");
  }
  function copyText(t) {
    if (AND && AND.copyText) { AND.copyText(t); return; }
    try { navigator.clipboard.writeText(t); } catch {}
  }
  function linkCard(title, rows, footer) {
    const card = document.createElement("div"); card.className = "card links";
    const b = document.createElement("b"); b.textContent = title; card.append(b);
    rows.forEach((r, i) => {
      const row = document.createElement("div"); row.className = "lrow";
      const h = document.createElement("div"); h.className = "lt"; h.textContent = `${i + 1}. ${r.title}`; row.append(h);
      if (r.sub) { const s = document.createElement("span"); s.className = "sub"; s.textContent = r.sub; row.append(s); }
      if (r.text) { const s = document.createElement("div"); s.className = "body"; s.textContent = r.text; row.append(s); }
      if (r.url && /^https:\/\//.test(r.url)) {
        const a = document.createElement("a"); a.href = r.url; a.target = "_blank"; a.rel = "noopener"; a.className = "btn"; a.textContent = r.linkText || "Öffnen";
        a.onclick = e => { e.preventDefault(); openUrl(r.url); };
        row.append(a);
      }
      card.append(row);
    });
    if (footer) { const f = document.createElement("span"); f.className = "sub"; f.textContent = footer; card.append(f); }
    log.append(card); log.scrollTop = log.scrollHeight;
  }
  // Produkt auf amazon.de finden: ASIN + Name + Preis
  async function findAmazon(item) {
    const r = await gemSearch(`Suche auf amazon.de das beste passende, gut bewertete Produkt für: "${item.replace(/"/g, "'")}". Kein Zubehör, außer es ist ausdrücklich gemeint.
Antworte NUR mit diesen drei Zeilen, ohne weiteren Text:
ASIN: <die 10-stellige Amazon-Produktnummer, wie in der Adresse amazon.de/dp/…>
NAME: <kurzer Produktname, höchstens 8 Wörter>
PREIS: <aktueller Preis in Euro, z. B. 12,99 – oder unbekannt>`);
    const t = r.text || "";
    const asin = ((/ASIN:\s*([A-Z0-9]{10})\b/.exec(t) || /\/dp\/([A-Z0-9]{10})/.exec(t) || [])[1]) || "";
    const name = ((/NAME:\s*(.+)/.exec(t) || [])[1] || item).trim().replace(/[*_`]/g, "").slice(0, 80);
    const price = parseEuro((/PREIS:\s*(.+)/.exec(t) || [])[1]);
    return { asin: /^(B0[A-Z0-9]{8}|\d{9}[\dX])$/.test(asin) ? asin : "", name, price };
  }

  /* ---------- 1) Amazon: „Bestell Zahnpasta auf Amazon“ → Warenkorb (nie kaufen) ---------- */
  const AMZ_RE = /^(?:bestell\w*|kauf\w*|leg\w*|pack\w*|tu\w*|setz\w*|füg\w*|hol\w*)\s+(?:mir\s+|bitte\s+|mal\s+|noch\s+)*(.+?)\s+(?:auf|bei|über|von|in)\s+amazon(?:\s+(?:in\s+den|in\s+meinen)\s+(?:warenkorb|einkaufswagen))?(?:\s+(?:rein|ein|hinzu))?$/i;
  const AMZ_RE2 = /^(?:leg\w*|pack\w*|tu\w*|setz\w*|füg\w*)\s+(?:mir\s+|bitte\s+|mal\s+)*(.+?)\s+(?:in|zu)\s+(?:den|meinen|meinem)\s+(?:amazon[- ]?)?(?:warenkorb|einkaufswagen)(?:\s+(?:bei|auf)\s+amazon)?(?:\s+(?:rein|hinzu))?$/i;
  async function handleAmazon(text) {
    const t = clean(text);
    const m = AMZ_RE.exec(t) || AMZ_RE2.exec(t);
    if (!m) return false;
    let item = m[1].trim(), qty = 1;
    const q = /^(\d{1,2}|ein|eine|einen|zwei|drei|vier|fünf|sechs|zehn)\s+(?:mal\s+|x\s+|stück\s+|packungen?\s+(?:von\s+|mit\s+)?|flaschen\s+|sets?\s+)?(.+)$/i.exec(item);
    if (q) { qty = isNaN(+q[1]) ? (AMZ_NUM[q[1].toLowerCase()] || 1) : +q[1]; item = q[2]; }
    item = item.replace(/^(?:die|das|den|der|neue[nsm]?|ne|nen)\s+/i, "").trim();
    if (!item) return false;
    if (CAR) {   // im Auto nichts am Handy öffnen – auf die Liste setzen
      const l = dataGet("lists", { einkauf: [], todo: [] }); l.einkauf = [...(l.einkauf || []), "Amazon: " + item]; dataSet("lists", l);
      assistantSay(`Ich habe „${item}“ auf deine Einkaufsliste gesetzt, ${anrede()}. Zuhause sag „Bestell ${item} auf Amazon“, dann lege ich es in den Warenkorb.`);
      return true;
    }
    if (!geminiKey) {
      if (AND && AND.amazonSearch) AND.amazonSearch(item); else openUrl("https://www.amazon.de/s?k=" + encodeURIComponent(item));
      assistantSay("Ich habe dir die Amazon-Suche geöffnet. Mit Gemini-Schlüssel kann ich das Produkt selbst aussuchen.");
      return true;
    }
    const done = busyBubble("Sucht auf Amazon …");
    let p = null, aborted = false;
    try { p = await findAmazon(item); } catch (e) { aborted = e && e.name === "AbortError"; }
    done();
    if (aborted) return true;
    if (!p || !p.asin) {
      if (AND && AND.amazonSearch) AND.amazonSearch(item); else openUrl("https://www.amazon.de/s?k=" + encodeURIComponent(item));
      assistantSay(`Ich habe kein eindeutiges Produkt gefunden, ${anrede()}. Ich habe dir die Amazon-Suche nach „${item}“ geöffnet.`);
      return true;
    }
    const pr = euroTxt(p.price);
    makePending("amazon", "🛒 In den Amazon-Warenkorb?", p.name + (pr ? " · ca. " + pr : ""), (qty > 1 ? qty + " Stück · " : "") + "Nur in den Warenkorb – bezahlt wird nichts. Bitte bei Amazon kurz prüfen, ob es das richtige Produkt ist.",
      "In den Warenkorb", "Abbrechen", { asin: p.asin, qty, name: p.name });
    assistantSay(`Gefunden, ${anrede()}: ${p.name}${pr ? " für ungefähr " + pr : ""}${qty > 1 ? ", " + qty + " Stück" : ""}. Soll ich es in den Warenkorb legen?`);
    return true;
  }
  function finishAmazon(p, ok) {
    if (!ok) { assistantSay("Okay, nicht in den Warenkorb gelegt."); return; }
    const url = `https://www.amazon.de/gp/aws/cart/add.html?ASIN.1=${p.asin}&Quantity.1=${p.qty}`;
    if (AND && AND.amazonCart) { AND.amazonCart(p.asin, p.qty); return; }
    openUrl(url);
    assistantSay("Ich habe Amazon geöffnet. Tipp dort auf „Weiter“, dann liegt es im Warenkorb.");
  }
  window.__zgShop = {
    emit(r) {
      if (r.type !== "cart") return;
      lastViaVoice = false;
      if (!r.ok) assistantSay("Amazon hat nicht geklappt: " + (r.msg || "Fehler"));
      else if (r.msg === "im Warenkorb") assistantSay(`Liegt im Warenkorb, ${anrede()}. Bezahlen machst du selbst, wenn du willst.`);
      else {
        assistantSay("Ich habe Amazon geöffnet. Tipp dort auf „In den Einkaufswagen“ bzw. „Weiter“.");
        if (AND && AND.whatsappAuto && !AND.whatsappAuto() && lsGet("zg_amz_tip") !== "1") { lsSet("zg_amz_tip", "1"); note("Tipp: Schalte in den App-Einstellungen die Bedienungshilfe „WhatsApp senden & Amazon-Warenkorb“ ein, dann tippt Jarvis das selbst."); }
      }
    },
  };

  /* ---------- 2) Preis-Wächter: „Sag mir Bescheid, wenn die AirPods unter 100 Euro fallen“ ---------- */
  const CRYPTO = /^(?:sol|solana|btc|bitcoin|eth|ethereum|doge|dogecoin|xrp|ripple|bonk|jup|jupiter|usdc|usdt|bnb|ada|cardano|pepe|shib|wif|trump|sui|ltc|avax|link|dot|matic|pol|ton|trx)$/i;
  const PW_RE = /(?:bescheid|benachrichtig\w*|meld\w*|sag\s+mir|informier\w*|ping)\b.*?(?:wenn|sobald|falls)\s+(?:der\s+preis\s+(?:von|für)\s+)?(?:der|die|das|den|mein\w*|ein\w*)?\s*(.+?)\s+(?:auf\s+amazon\s+|bei\s+amazon\s+)?(?:unter|billiger\s+als|weniger\s+als|für\s+unter)\s+([\d.,]+)\s*(?:euro|€)?(?:\s+(?:fällt|fallen|kostet|kosten|ist|sind|geht|gehen|sinkt|sinken|gibt))?\s*$/i;
  async function handlePriceWatch(text) {
    const tl = clean(text).toLowerCase();
    if (/(welche|meine|zeig\w*)\s+preis-?\s*wächter/.test(tl)) {
      if (!AND || !AND.priceWatchList) { assistantSay("Preis-Wächter gibt es nur in der Android-App."); return true; }
      const l = JSON.parse(AND.priceWatchList() || "[]");
      if (!l.length) { assistantSay("Du hast keine Preis-Wächter."); return true; }
      extraCard("📉 Preis-Wächter", l.map(x => `${x.name}: unter ${euroTxt(x.limit)}`));
      assistantSay(`Du hast ${l.length} Preis-Wächter.`); return true;
    }
    if (/lösch\w*\s+(?:alle\s+)?(?:meine\s+)?preis-?\s*wächter/.test(tl)) { if (AND && AND.priceWatchCancel) AND.priceWatchCancel(-1); assistantSay("Alle Preis-Wächter sind gelöscht."); return true; }
    const m = PW_RE.exec(clean(text));
    if (!m) return false;
    const item = m[1].trim().replace(/^(?:die|das|den|der)\s+/i, "");
    if (CRYPTO.test(item) || /dollar|\$|kurs|coin|token/i.test(text)) return false;   // Krypto → Kurs-Alarm
    const limit = parseEuro(m[2]);
    if (!isFinite(limit) || limit <= 0) return false;
    if (!AND || !AND.priceWatchAdd) { assistantSay("Der Preis-Wächter geht nur in der Android-App, weil das Handy im Hintergrund nachschauen muss."); return true; }
    if (!geminiKey) { assistantSay("Für den Preis-Wächter brauche ich deinen Gemini-Schlüssel (KI-Quelle)."); return true; }
    const done = busyBubble("Sucht das Produkt …");
    let p = null;
    try { p = await findAmazon(item); } catch {}
    done();
    if (!p || !p.asin) { assistantSay(`Ich habe „${item}“ auf Amazon nicht eindeutig gefunden. Sag es bitte etwas genauer, zum Beispiel mit Marke und Modell.`); return true; }
    if (isFinite(p.price) && p.price <= limit) {
      makePending("amazon", "🛒 Schon günstig genug!", p.name + " · ca. " + euroTxt(p.price), "Nur in den Warenkorb – bezahlt wird nichts.", "In den Warenkorb", "Nein danke", { asin: p.asin, qty: 1, name: p.name });
      assistantSay(`${p.name} kostet gerade schon ungefähr ${euroTxt(p.price)}, also unter ${euroTxt(limit)}. Soll ich es in den Warenkorb legen?`);
      return true;
    }
    try { AND.priceWatchModel(geminiModel || ""); } catch {}
    AND.priceWatchAdd(p.asin, p.name, String(limit), String(isFinite(p.price) ? p.price : 0));
    assistantSay(`Mach ich, ${anrede()}. Ich schaue alle paar Stunden nach und sage dir Bescheid, wenn ${p.name} unter ${euroTxt(limit)} fällt.` + (isFinite(p.price) ? ` Gerade kostet es ungefähr ${euroTxt(p.price)}.` : ""));
    return true;
  }

  /* ---------- 3) Verkaufs-Helfer: „Verkauf meinen alten Xbox-Controller“ → fertige Kleinanzeige ---------- */
  const SELL_RE = /^(?:(?:ich\s+)?(?:will|möchte|würde\s+gern|würde\s+gerne|muss)\s+)(?:mein\w*\s+|den\s+|die\s+|das\s+|unser\w*\s+)?(.+?)\s+verkaufen$|^verkauf\w*\s+(?:mir\s+|bitte\s+|mal\s+)*(?:mein\w*\s+|den\s+|die\s+|das\s+)?(.+)$|^(?:erstell|schreib|mach)\w*\s+(?:mir\s+)?(?:bitte\s+)?(?:eine\s+)?(?:klein-?anzeige|anzeige|verkaufsanzeige|ebay-?anzeige)\s+(?:für|zu|von)\s+(?:mein\w*\s+|den\s+|die\s+|das\s+)?(.+)$/i;
  async function handleSell(text) {
    const m = SELL_RE.exec(clean(text));
    if (!m) return false;
    const item = (m[1] || m[2] || m[3] || "").trim();
    if (!item || /aktie|krypto|coin|token|bitcoin|solana|wallet|seele|haus|auto\b/i.test(item)) return false;
    if (!backend) { assistantSay("Dafür brauche ich die KI. Ist Gemini eingerichtet?"); return true; }
    const done = busyBubble("Schreibt die Anzeige …");
    let a = null;
    const prompt = `Damian will „${item.replace(/"/g, "'")}“ gebraucht auf Kleinanzeigen (kleinanzeigen.de) verkaufen. Er hat nur das gesagt: "${text.replace(/"/g, "'")}".
Schätze einen realistischen Verkaufspreis für Deutschland (was solche Sachen gebraucht auf Kleinanzeigen/eBay gerade bringen) und schreibe eine ehrliche, gut verkaufende Anzeige auf Deutsch.
Erfinde KEINE Details, die er nicht genannt hat (Zustand, Zubehör, Farbe): schreib stattdessen Platzhalter in eckigen Klammern wie [Zustand ergänzen].
Antworte nur mit einem JSON-Objekt: {"titel": "max. 60 Zeichen", "preis": Zahl in Euro, "preis_spanne": "z. B. 20–30 €", "beschreibung": "4 bis 8 kurze Zeilen, mit Hinweis Privatverkauf, keine Garantie/Rücknahme", "tipp": "ein kurzer Verkaufstipp (z. B. gute Fotos, Versand)"}`;
    try {
      if (geminiKey) { const r = await gemSearch(prompt); a = jsonIn(r.text); }
      if (!a) a = await llmJson(prompt, { type: "object", properties: { titel: { type: "string" }, preis: { type: "number" }, preis_spanne: { type: "string" }, beschreibung: { type: "string" }, tipp: { type: "string" } }, required: ["titel", "preis", "beschreibung"] });
    } catch (e) { done(); if (!(e && e.name === "AbortError")) assistantSay("Die Anzeige hat gerade nicht geklappt. " + (e.message || "")); return true; }
    done();
    if (!a || !a.titel) { assistantSay("Die Anzeige hat gerade nicht geklappt. Versuch es nochmal."); return true; }
    const price = Math.round(+a.preis || 0);
    const full = `${a.titel}\n\nPreis: ${price} € VB\n\n${a.beschreibung}`;
    const sales = dataGet("sales", []); sales.push({ item, titel: a.titel, preis: price, text: full, ts: Date.now() }); dataSet("sales", sales.slice(-30));
    makePending("sell", "🏷 Kleinanzeige: " + a.titel, `Preisvorschlag: ${price} € VB` + (a.preis_spanne ? ` (üblich ${a.preis_spanne})` : ""), a.beschreibung + (a.tipp ? "\n\n💡 " + a.tipp : ""),
      "Kopieren & Kleinanzeigen öffnen", "Schließen", { text: full });
    assistantSay(`Deine Anzeige ist fertig, ${anrede()}. Ich würde ${price} Euro Verhandlungsbasis nehmen. Soll ich sie kopieren und Kleinanzeigen öffnen? Dann nur noch Fotos dazu und einfügen.`);
    return true;
  }
  function finishSell(p, ok) {
    if (!ok) { assistantSay("Okay. Die Anzeige ist gespeichert, sag „Zeig meine Anzeige“, wenn du sie brauchst."); return; }
    copyText(p.text);
    openUrl("https://www.kleinanzeigen.de/p-anzeige-aufgeben.html", "com.ebay.kleinanzeigen");
    assistantSay("Kopiert! In Kleinanzeigen: Anzeige aufgeben, Fotos rein, Text lange drücken und einfügen.");
  }
  function handleSellShow(text) {
    if (!/^(?:zeig|lies)\w*\s+(?:mir\s+)?(?:meine\s+)?(?:letzte\s+)?(?:klein)?anzeige/i.test(clean(text))) return false;
    const s = dataGet("sales", []).slice(-1)[0];
    if (!s) { assistantSay("Du hast noch keine Anzeige von mir. Sag zum Beispiel: Verkauf meinen alten Controller."); return true; }
    makePending("sell", "🏷 " + s.titel, `Preis: ${s.preis} € VB`, s.text, "Kopieren & Kleinanzeigen öffnen", "Schließen", { text: s.text });
    assistantSay("Hier ist deine letzte Anzeige. Soll ich sie kopieren?");
    return true;
  }

  /* ---------- 4) Spar-Coach: „Wo kann ich sparen?“ ---------- */
  const SAVE_RE = /spar-?\s*coach|(?:wie|wo)\s+(?:kann|könnte|soll)\s+ich\s+(?:mehr\s+|am\s+besten\s+)?(?:geld\s+)?(?:sparen|einsparen)|spar-?\s*tipps?|geld\s+sparen|welche\s+(?:abos|verträge)\s+(?:kann|sollte|soll)\s+ich\s+kündigen|wofür\s+geb\w*\s+ich\s+(?:zu\s+viel|am\s+meisten)\s+(?:geld\s+)?aus/i;
  async function handleSave(text) {
    if (!SAVE_RE.test(text)) return false;
    let d = null;
    try { d = AND && AND.bankCached ? JSON.parse(AND.bankCached() || "null") : null; } catch {}
    if (!d || !d.ok) { assistantSay("Dafür brauche ich deine Kontodaten. Frag mich einmal „Wie sieht's aus mit meinen Finanzen?“, dann kann ich dir danach genau sagen, wo du sparen kannst."); return true; }
    const a = finAnalyze(d);
    const full = Object.keys(a.months).sort().filter(k => k !== a.cur).slice(-3);
    const avg = {};
    for (const k of full) for (const [c, v] of Object.entries(a.months[k].cats)) avg[c] = (avg[c] || 0) + v / full.length;
    const avgInc = full.reduce((s, k) => s + a.months[k].inc, 0) / (full.length || 1), avgOut = full.reduce((s, k) => s + a.months[k].out, 0) / (full.length || 1);
    const facts = [
      `Durchschnitt der letzten ${full.length} Monate: Einnahmen ${Math.round(avgInc)} €, Ausgaben ${Math.round(avgOut)} €.`,
      "Ausgaben nach Kategorie pro Monat: " + Object.entries(avg).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([c, v]) => `${c} ${Math.round(v)} €`).join(", ") + ".",
      "Feste Zahlungen/Abos: " + (a.fixed.slice(0, 12).map(f => `${f.name} ${f.amount.toFixed(2)} € (${f.cat})`).join(", ") || "keine erkannt") + ".",
    ].join("\n");
    const done = busyBubble("Rechnet nach …");
    let r = null;
    try {
      r = await llmJson(`Du bist ein ehrlicher Spar-Coach für einen Azubi (Elektroniker). Das sind seine echten Kontodaten:\n${facts}\n\nGib 3 bis 4 konkrete, realistische Spartipps NUR auf Basis dieser Daten (z. B. ein bestimmtes Abo kündigen oder günstiger wechseln, Essen-gehen-Budget). Keine Anlage- oder Trading-Tipps. Schätze, wie viel Euro im Monat jeder Tipp spart. Du-Form, kurz.`,
        { type: "object", properties: { tipps: { type: "array", items: { type: "object", properties: { titel: { type: "string" }, euro_pro_monat: { type: "number" }, wie: { type: "string" } }, required: ["titel", "euro_pro_monat", "wie"] } } }, required: ["tipps"] });
    } catch (e) { done(); if (!(e && e.name === "AbortError")) assistantSay("Das hat gerade nicht geklappt. " + (e.message || "")); return true; }
    done();
    const tips = (r && r.tipps || []).slice(0, 4);
    if (!tips.length) { assistantSay("Ich habe gerade keine guten Spartipps gefunden – deine Ausgaben sehen ordentlich aus."); return true; }
    const sum = tips.reduce((s, x) => s + Math.max(0, +x.euro_pro_monat || 0), 0);
    extraCard(`💰 Spar-Coach · bis zu ${Math.round(sum)} € im Monat`, tips.map(x => `${x.titel}: ${Math.round(x.euro_pro_monat)} €/Monat – ${x.wie}`),
      `Das sind ${Math.round(sum * 12)} € im Jahr.`);
    assistantSay(`Du könntest bis zu ${Math.round(sum)} Euro im Monat sparen, ${anrede()}, also ${Math.round(sum * 12)} Euro im Jahr. Am meisten bringt: ${tips[0].titel}.`);
    return true;
  }

  /* ---------- 5) Job-Finder: „Such mir Programmier-Jobs“ → echte Angebote + fertige Bewerbung ---------- */
  const JOB_RE = /^(?:such|find)\w*\s+(?:mir\s+)?(?:bitte\s+)?(?:mal\s+)?(?:einen?\s+|ein\s+paar\s+|paar\s+|neue\s+)?(?:neben-?jobs?|mini-?jobs?|aufträge|auftrag|programmier-?(?:jobs?|aufträge)|freelance-?(?:jobs?|aufträge)|jobs?|gigs?)\b|wie\s+(?:kann|könnte)\s+ich\s+(?:nebenbei\s+|schnell\s+|mehr\s+)?(?:geld\s+verdienen|was\s+dazu\s*verdienen|geld\s+dazu\s*verdienen)|^(?:ich\s+)?(?:will|möchte|brauche?)\s+(?:mehr\s+|nebenbei\s+)?geld\s+verdienen/i;
  const APPLY_RE = /(?:schreib\w*|mach\w*|erstell\w*)\s+(?:mir\s+)?(?:eine\s+)?(?:bewerbung|nachricht|anschreiben)\s+(?:für|zu|an)\s+(?:den\s+|das\s+)?(?:job|angebot|auftrag|nummer)?\s*(\d|eins|zwei|drei|vier|fünf)|bewirb\s+mich\s+(?:auf|für|bei)\s+(?:den\s+|das\s+)?(?:job|angebot|auftrag|nummer)?\s*(\d|eins|zwei|drei|vier|fünf)/i;
  async function handleJobs(text) {
    const ap = APPLY_RE.exec(clean(text));
    if (ap) return applyJob(ap[1] || ap[2]);
    if (!JOB_RE.test(clean(text))) return false;
    if (!geminiKey) { assistantSay("Für die Job-Suche brauche ich deinen Gemini-Schlüssel, weil ich dafür im Internet suchen muss."); return true; }
    const me = dataGet("me", {});
    const where = me.city || me.home || "Haßfurt (Unterfranken)";
    const wantsCode = /programm|code|freelance|auftr|gig|online/i.test(text);
    const done = busyBubble("Sucht Jobs …");
    let r = null;
    try {
      r = await gemSearch(`Suche im Internet nach AKTUELLEN, echten Angeboten (keine erfundenen!) für einen Azubi zum Elektroniker für Automatisierungstechnik, der nebenbei Geld verdienen will.
${wantsCode ? "Schwerpunkt: kleine Programmier-Aufträge (z. B. Python-Skripte, Webseiten, Excel/VBA, Arduino/ESP32, SPS), die man online erledigen kann." : `Mischung aus: kleine Programmier-/Technik-Aufträge online (z. B. Arduino, Python, Webseiten, SPS) UND Minijobs/Nebenjobs in der Nähe von ${where} (z. B. Elektro-Helfer, Technik-Aushilfe, Nachhilfe).`}
Gib 5 Treffer. Antworte nur mit einem JSON-Objekt: {"jobs":[{"titel":"…","wo":"Plattform/Firma und Ort oder online","verdienst":"ungefähr, falls bekannt","warum":"1 kurzer Satz, warum es passt","link":"https://… direkte Adresse der Anzeige oder Plattform"}]}`);
    } catch (e) { done(); if (!(e && e.name === "AbortError")) assistantSay("Die Suche hat gerade nicht geklappt. " + (e.message || "")); return true; }
    done();
    const j = jsonIn(r && r.text);
    let jobs = (j && Array.isArray(j.jobs) ? j.jobs : []).filter(x => x && x.titel).slice(0, 5);
    // Links: nur echte https-Adressen; sonst die Quelle aus der Google-Suche
    jobs = jobs.map((x, i) => ({ ...x, link: /^https:\/\/\S+$/.test(x.link || "") ? x.link : ((r.links[i] || {}).uri || "") }));
    if (!jobs.length) { assistantSay("Ich habe gerade keine passenden Angebote gefunden. Versuch es später nochmal."); return true; }
    dataSet("jobs", jobs);
    linkCard("💼 Job-Finder", jobs.map(x => ({ title: x.titel, sub: [x.wo, x.verdienst].filter(Boolean).join(" · "), text: x.warum, url: x.link, linkText: "Anzeige öffnen" })),
      "Tipp: Als Azubi musst du einen Nebenjob deinem Ausbildungsbetrieb melden. Sag „Schreib mir eine Bewerbung für Job 2“ – den Auftrag selbst machen wir dann zusammen.");
    assistantSay(`Ich habe ${jobs.length} Angebote gefunden, ${anrede()}. Das erste: ${jobs[0].titel}. Sag zum Beispiel „Schreib mir eine Bewerbung für Job 1“, dann schreibe ich sie dir vor.`);
    return true;
  }
  async function applyJob(nr) {
    const n = isNaN(+nr) ? ({ eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5 }[String(nr).toLowerCase()] || 1) : +nr;
    const job = dataGet("jobs", [])[n - 1];
    if (!job) { assistantSay("Such zuerst Jobs mit „Such mir Nebenjobs“, dann kann ich eine Bewerbung schreiben."); return true; }
    if (!backend) { assistantSay("Dafür brauche ich die KI."); return true; }
    const done = busyBubble("Schreibt die Bewerbung …");
    let r = null;
    try {
      r = await llmJson(`Schreibe eine kurze, freundliche Bewerbung/Nachricht auf Deutsch (oder Englisch, falls die Plattform englisch ist) für dieses Angebot: "${job.titel}" (${job.wo}). Absender: Damian, Azubi zum Elektroniker für Automatisierungstechnik, motiviert, lernt schnell, Erfahrung mit SPS und Elektrotechnik, programmiert mit KI-Unterstützung. Ehrlich bleiben, nichts übertreiben. 5 bis 8 Sätze, mit Platzhaltern in eckigen Klammern für Dinge, die er selbst ergänzen muss.`,
        { type: "object", properties: { betreff: { type: "string" }, text: { type: "string" } }, required: ["text"] });
    } catch (e) { done(); if (!(e && e.name === "AbortError")) assistantSay("Das hat gerade nicht geklappt. " + (e.message || "")); return true; }
    done();
    const full = (r.betreff ? r.betreff + "\n\n" : "") + r.text;
    makePending("copy", "✉ Bewerbung: " + job.titel, job.wo || "", full, "Kopieren & Anzeige öffnen", "Schließen", { text: full, url: job.link });
    assistantSay(`Deine Bewerbung ist fertig, ${anrede()}. Lies sie kurz durch und ergänze die Stellen in eckigen Klammern. Soll ich sie kopieren und die Anzeige öffnen?`);
    return true;
  }
  function finishCopy(p, ok) {
    if (!ok) { assistantSay("Okay."); return; }
    copyText(p.text);
    if (p.url) openUrl(p.url);
    assistantSay("Kopiert. Einfach in das Nachrichtenfeld einfügen und abschicken.");
  }

  async function handleShop(text) {
    if (await handleAmazon(text)) return true;
    if (await handlePriceWatch(text)) return true;
    if (handleSellShow(text)) return true;
    if (await handleSell(text)) return true;
    if (await handleSave(text)) return true;
    if (await handleJobs(text)) return true;
    return false;
  }
