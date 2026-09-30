  /* ---------- Finanzen (Bankkonto, nur Android-App): Einnahmen, Ausgaben, Fixkosten ---------- */
  const FIN_CATS = [
    ["Lebensmittel", /rewe|edeka|aldi|lidl|netto|penny|kaufland|norma|real\b|globus|tegut|marktkauf|nahkauf|denn'?s|alnatura|bäcker|baecker|backhaus|metzger/],
    ["Essen & Trinken", /mc ?donald|burger ?king|kfc|subway|lieferando|wolt|uber ?eats|domino|pizza|döner|doener|kebab|restaurant|imbiss|cafe|café|starbucks|coffee|bar\b|kneipe/],
    ["Tanken & Auto", /aral|shell|esso|jet\b|total|agip|eni\b|avia|tankstelle|star tank|hem\b|oil!|kfz|werkstatt|atu\b|parken|parkhaus|easypark/],
    ["Mobilität", /deutsche bahn|db vertrieb|\bdb\b|bahn|flixbus|uber|bolt|tier|lime|dott|mvg|bvg|hvv|vrs|kvb|rmv|vvs|ticket|deutschlandticket/],
    ["Abos & Streaming", /spotify|netflix|disney|amazon prime|prime video|dazn|sky\b|youtube|apple\.com|itunes|google \*|playstation|psn|xbox|nintendo|steam|twitch|audible|chatgpt|openai|anthropic|claude/],
    ["Handy & Internet", /telekom|vodafone|o2|telefonica|congstar|aldi talk|1&1|1und1|freenet|mobilcom|blau\.de|fraenk|klarmobil|drillisch/],
    ["Versicherung", /versicherung|allianz|huk|axa|ergo|debeka|generali|signal iduna|devk|provinzial|barmenia|gothaer|haftpflicht/],
    ["Wohnen", /miete|vermiet|wohnung|nebenkosten|stadtwerke|strom|gas\b|energie|eon|e\.on|vattenfall|rundfunk|gez|beitragsservice/],
    ["Shopping", /amazon|zalando|otto\b|ebay|about you|h&m|zara|primark|nike|adidas|media ?markt|saturn|ikea|dm\b|rossmann|müller|mueller|douglas|decathlon|shein|temu/],
    ["Bargeld", /geldautomat|bargeld|auszahlung|atm\b|cash/],
    ["Krypto & Trading", /coinbase|bitpanda|kraken|binance|moonpay|trade republic|scalable|n26 crypto|bison|phantom|fomo/],
    ["Sport & Freizeit", /fitness|mcfit|clever fit|john reed|fitx|urban sports|kino|cinema|eventim|ticketmaster|verein/],
    ["PayPal", /paypal/],
  ];
  const finCat = t => { const s = (t.name + " " + t.text).toLowerCase(); for (const [c, re] of FIN_CATS) if (re.test(s)) return c; return t.amount > 0 ? "Eingang" : "Sonstiges"; };
  const finKey = t => ((t.name || t.text || "?").toLowerCase().replace(/\d{4,}/g, "").replace(/[^a-zäöüß ]+/g, " ").replace(/\b(gmbh|ag|se|kg|co|ltd|inc|eu|de|sagt danke|lastschrift|sepa|online|payment|zahlung)\b/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ")) || "?";
  const ym = d => d.slice(0, 7);
  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const monthName = k => MONTHS[+k.slice(5, 7) - 1];
  function finAnalyze(d) {
    const tx = (d.transactions || []).filter(t => t.date && isFinite(t.amount))
      .map(t => ({ ...t, name: t.name === "null" ? "" : (t.name || ""), text: t.text === "null" ? "" : (t.text || "") }));
    const now = new Date(), cur = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const prevD = new Date(now.getFullYear(), now.getMonth() - 1, 1), prev = `${prevD.getFullYear()}-${pad(prevD.getMonth() + 1)}`;
    const months = {};
    for (const t of tx) {
      const m = months[ym(t.date)] || (months[ym(t.date)] = { inc: 0, out: 0, cats: {} });
      if (t.amount > 0) m.inc += t.amount; else { m.out += -t.amount; const c = finCat(t); m.cats[c] = (m.cats[c] || 0) - t.amount; }
    }
    // Fixkosten: gleicher Empfänger in mind. 2 verschiedenen Monaten mit ähnlichem Betrag
    const groups = {};
    for (const t of tx) { const k = (t.amount > 0 ? "+" : "-") + finKey(t); (groups[k] || (groups[k] = [])).push(t); }
    const fixed = [], income = [];
    for (const [k, list] of Object.entries(groups)) {
      const ms = new Set(list.map(t => ym(t.date)));
      if (ms.size < 2) continue;
      const amts = list.map(t => Math.abs(t.amount)).sort((a, b) => a - b), med = amts[Math.floor(amts.length / 2)];
      const similar = list.filter(t => Math.abs(Math.abs(t.amount) - med) <= Math.max(2, med * 0.2));
      if (new Set(similar.map(t => ym(t.date))).size < 2) continue;
      if (similar.length / ms.size > 2.5) continue;            // zu oft im Monat = eher Einkauf als Fixkosten
      if (k[0] === "-" && /^(Lebensmittel|Essen & Trinken|Tanken & Auto|Shopping|Bargeld)$/.test(finCat(list[0]))) continue;   // Einkäufe sind keine Fixkosten
      const last = similar.map(t => t.date).sort().pop();
      const item = { name: list[0].name || finKey(list[0]), amount: med, cat: finCat(list[0]), last, thisMonth: similar.some(t => ym(t.date) === cur) };
      (k[0] === "+" ? income : fixed).push(item);
    }
    fixed.sort((a, b) => b.amount - a.amount); income.sort((a, b) => b.amount - a.amount);
    return { balance: d.balance, fetched: d.fetched, cur, prev, months, fixed, income, fixedSum: fixed.reduce((a, x) => a + x.amount, 0), incomeSum: income.reduce((a, x) => a + x.amount, 0), count: tx.length };
  }

  /* ---------- Statistik (SVG-Diagramme im Chat) ---------- */
  const C_IN = "#1a95bd", C_OUT = "#c97a1c";   // geprüft: farbenblind-sicher auf dunklem Grund
  const svgEl = (tag, attrs, parent) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.append(e); return e; };
  const short = v => v >= 1000 ? (v / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + "k" : Math.round(v).toString();
  // Balken mit oben abgerundeten Ecken (4px), unten gerade auf der Grundlinie
  function barPath(x, y, w, h) { const r = Math.min(4, w / 2, h); return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; }
  function finStatsCard(a) {
    const card = document.createElement("div"); card.className = "card stats-card";
    const t = document.createElement("b"); t.textContent = "Konto-Statistik"; card.append(t);
    const keys = Object.keys(a.months).sort().slice(-6);
    const full = keys.filter(k => k !== a.cur);
    const avgOut = full.length ? full.reduce((s, k) => s + a.months[k].out, 0) / full.length : (a.months[a.cur] || { out: 0 }).out;
    const avgIn = full.length ? full.reduce((s, k) => s + a.months[k].inc, 0) / full.length : (a.months[a.cur] || { inc: 0 }).inc;
    const rate = avgIn > 0 ? Math.round((avgIn - avgOut) / avgIn * 100) : 0;
    const kp = document.createElement("div"); kp.className = "kpis";
    for (const [l, v] of [["Kontostand", (a.balance < 0 ? "−" : "") + eur(a.balance).replace(" Euro", " €")], ["Ø Ausgaben", eur(avgOut).replace(" Euro", " €")], ["Sparquote", rate + " %"]]) {
      const d = document.createElement("div"); d.className = "kpi"; d.innerHTML = "<span></span><b></b>"; d.children[0].textContent = l; d.children[1].textContent = v; kp.append(d);
    }
    card.append(kp);
    const tip = document.createElement("div"); tip.className = "chart-tip"; tip.textContent = "Tippe auf einen Balken für den genauen Betrag.";
    const bindTip = (el, text) => { el.classList.add("bar"); el.addEventListener("pointerenter", () => { tip.textContent = text; }); el.addEventListener("click", () => { card.querySelectorAll(".bar.on").forEach(b => b.classList.remove("on")); el.classList.add("on"); tip.textContent = text; }); const ti = svgEl("title", {}, el); ti.textContent = text; };

    // 1) Einnahmen vs. Ausgaben pro Monat
    const h1 = document.createElement("div"); h1.className = "chart-h"; h1.innerHTML = `Monate <i style="--c:${C_IN}">Einnahmen</i><i style="--c:${C_OUT}">Ausgaben</i>`; card.append(h1);
    const W = 600, H = 230, padL = 48, padB = 30, padT = 16;
    const max = Math.max(1, ...keys.map(k => Math.max(a.months[k].inc, a.months[k].out)));
    const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / p) * p; })();
    const sv = svgEl("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Einnahmen und Ausgaben pro Monat" });
    for (let i = 0; i <= 2; i++) {
      const y = padT + (H - padT - padB) * (1 - i / 2);
      svgEl("line", { x1: padL, x2: W, y1: y, y2: y, stroke: "rgba(120,170,210,.14)", "stroke-width": 1 }, sv);
      const tx = svgEl("text", { x: padL - 6, y: y + 4, "text-anchor": "end" }, sv); tx.textContent = short(nice * i / 2);
    }
    const gw = (W - padL) / keys.length, bw = Math.min(28, gw / 3);
    keys.forEach((k, i) => {
      const m = a.months[k], cx = padL + gw * i + gw / 2;
      [[m.inc, C_IN, -1, "Einnahmen"], [m.out, C_OUT, 1, "Ausgaben"]].forEach(([v, c, side, lbl]) => {
        const h = (H - padT - padB) * v / nice, x = cx + (side < 0 ? -bw - 1 : 1);
        const pth = svgEl("path", { d: barPath(x, H - padB - h, bw, Math.max(h, 0.5)), fill: c }, sv);
        bindTip(pth, `${monthName(k)}: ${lbl} ${eur(v)}`);
      });
      const lb = svgEl("text", { x: cx, y: H - 6, "text-anchor": "middle" }, sv); lb.textContent = monthName(k).slice(0, 3) + (k === a.cur ? " (lfd.)" : "");
    });
    card.append(sv);

    // 2) Ausgaben nach Kategorie (aktueller Monat, sonst Vormonat)
    const mk = a.months[a.cur] && a.months[a.cur].out > 0 ? a.cur : a.prev;
    const cats = Object.entries((a.months[mk] || { cats: {} }).cats).sort((x, y) => y[1] - x[1]).slice(0, 7);
    if (cats.length) {
      const h2 = document.createElement("div"); h2.className = "chart-h"; h2.textContent = "Ausgaben nach Kategorie · " + monthName(mk); card.append(h2);
      const rowH = 32, W2 = 600, lab = 200, H2 = cats.length * rowH + 4, cmax = cats[0][1];
      const s2 = svgEl("svg", { class: "chart", viewBox: `0 0 ${W2} ${H2}`, role: "img", "aria-label": "Ausgaben nach Kategorie" });
      cats.forEach(([c, v], i) => {
        const y = i * rowH + 4, w = Math.max(2, (W2 - lab - 80) * v / cmax);
        const l = svgEl("text", { x: 0, y: y + 17 }, s2); l.textContent = c;
        const r = Math.min(4, w / 2);
        const pth = svgEl("path", { d: `M${lab},${y}H${lab + w - r}Q${lab + w},${y} ${lab + w},${y + r}V${y + 22 - r}Q${lab + w},${y + 22} ${lab + w - r},${y + 22}H${lab}Z`, fill: C_IN }, s2);
        bindTip(pth, `${c}: ${eur(v)}`);
        const vt = svgEl("text", { x: lab + w + 6, y: y + 17, class: "v" }, s2); vt.textContent = eur(v).replace(" Euro", " €");
      });
      card.append(s2);
    }
    // 3) Fixkosten
    if (a.fixed.length) {
      const h3 = document.createElement("div"); h3.className = "chart-h"; h3.textContent = `Fixkosten · ${eur(a.fixedSum)} im Monat`; card.append(h3);
      const bd = document.createElement("div"); bd.className = "body"; bd.textContent = a.fixed.slice(0, 8).map(x => `${x.name}: ${eur(x.amount)}`).join("\n"); card.append(bd);
    }
    card.append(tip);
    log.append(card); log.scrollTop = log.scrollHeight;
    return { avgIn, avgOut, rate, cats, mk };
  }

  let finWait = null;
  window.__zgBank = { emit(r) { if (r.type === "data" && finWait) { const w = finWait; finWait = null; w(r.data); } } };
  async function finData(force) {
    let d = null; try { d = JSON.parse(AND.bankCached() || "null"); } catch {}
    if (!force && d && d.ok && Date.now() - d.fetched < 2 * 3600000) return d;
    const fresh = await new Promise(res => { finWait = res; AND.bankFetch(); setTimeout(() => { if (finWait === res) { finWait = null; res(null); } }, 60000); });
    if (fresh && fresh.ok) return fresh;
    if (d && d.ok) { note("Konnte nicht neu laden (" + ((fresh && fresh.error) || "Zeitüberschreitung") + "), nehme den letzten Stand."); return d; }
    throw new Error((fresh && fresh.error) || "Keine Antwort von der Bank");
  }
  const eur = v => euro(Math.round(Math.abs(v) * 100) / 100);
  function finCard(title, lines) {
    const card = document.createElement("div"); card.className = "card";
    const b = document.createElement("b"); b.textContent = title; card.append(b);
    const body = document.createElement("div"); body.className = "body"; body.textContent = lines.join("\n"); card.append(body);
    log.append(card); log.scrollTop = log.scrollHeight;
  }
  const FIN_Q = /\b(finanz\w*|konto\w*|kontostand|guthaben|ausgaben|ausgegeben|einnahmen|eingegangen|eingang|reingekommen|rausgegangen|fixkosten|fixe kosten|abos?|abonnements?|gehalt|lohn|ausbildungsverg\w*|budget|sparkasse|übrig|ausgeben|verbraucht|statistik\w*|diagramm\w*|grafik\w*|auswertung)\b|wie\s*viel\s+geld\s+hab/i;
  async function handleFinance(text) {
    if (!FIN_Q.test(text)) return false;
    const t = text.toLowerCase();
    if (/wie\s*viel\s+geld\s+hab/.test(t) && /(ph|f)antom|wall?et|wollet|krypto|crypto|portfolio/.test(t)) return false;   // Wallet-Frage
    if (!AND || typeof AND.bankState !== "function") {
      if (/wie\s*viel\s+geld\s+hab/.test(t)) return false;
      assistantSay("Deine Kontodaten kann ich nur in der Android-App auf deinem Handy abrufen."); return true;
    }
    const st = JSON.parse(AND.bankState());
    if (!st.connected) {
      if (/wie\s*viel\s+geld\s+hab/.test(t)) return false;
      assistantSay(st.bank ? "Die Freigabe für dein Konto ist abgelaufen. Verbinde es in den App-Einstellungen bitte neu." : "Dein Konto ist noch nicht verbunden. Das machst du in den App-Einstellungen unter Bankkonto.");
      return true;
    }
    busy = true; refreshUi();
    let a;
    try { a = finAnalyze(await finData(/aktualisier|neu laden|frisch/.test(t))); }
    catch (e) { busy = false; refreshUi(); assistantSay("Ich komme gerade nicht an dein Konto. " + e.message); return true; }
    busy = false; refreshUi();
    const which = /letzt\w* monat|vormonat|vorigen monat/.test(t) ? a.prev : a.cur;
    const m = a.months[which] || { inc: 0, out: 0, cats: {} };
    const mName = which === a.cur ? "diesen Monat" : "im " + monthName(which);
    // Statistik mit Diagrammen
    if (/statistik|diagramm|grafik|chart|auswertung|zeig.*(überblick|übersicht)/.test(t)) {
      const s2 = finStatsCard(a);
      assistantSay(`Hier ist deine Statistik. Im Schnitt nimmst du ${eur(s2.avgIn)} im Monat ein und gibst ${eur(s2.avgOut)} aus, damit sparst du etwa ${s2.rate} Prozent.` + (s2.cats.length ? ` Größter Ausgabenposten im ${monthName(s2.mk)}: ${s2.cats[0][0]} mit ${eur(s2.cats[0][1])}.` : ""));
      return true;
    }
    // Fixkosten / Abos
    if (/fixkosten|fixe kosten|abos?\b|abonnements?|laufende kosten|monatlich/.test(t)) {
      const list = /abos?\b|abonnements?/.test(t) ? a.fixed.filter(x => x.cat === "Abos & Streaming" || x.cat === "Handy & Internet") : a.fixed;
      if (!list.length) { assistantSay("Ich finde noch keine festen monatlichen Kosten. Dafür brauche ich Umsätze aus mindestens zwei Monaten."); return true; }
      const sum = list.reduce((s, x) => s + x.amount, 0);
      finCard("Fixkosten · " + eur(sum) + " im Monat", list.map(x => `${x.thisMonth ? "✓" : "○"} ${x.name}: ${eur(x.amount)} (${x.cat})`));
      const open = list.filter(x => !x.thisMonth);
      assistantSay(`Deine festen Kosten sind etwa ${eur(sum)} im Monat. Die größten: ${list.slice(0, 3).map(x => `${x.name} ${eur(x.amount)}`).join(", ")}.` + (open.length ? ` Diesen Monat noch nicht abgebucht: ${open.slice(0, 3).map(x => x.name).join(", ")}.` : ""));
      return true;
    }
    // Wofür ausgegeben / Kategorie
    const catHit = FIN_CATS.find(([c]) => t.includes(c.toLowerCase().split(" ")[0].replace(/&.*/, "").trim()));
    const catWord = /essen|restaurant|liefer/.test(t) ? "Essen & Trinken" : /einkauf|lebensmittel|supermarkt/.test(t) ? "Lebensmittel" : /tank|sprit|benzin/.test(t) ? "Tanken & Auto" : /shopping|online|amazon|klamotten/.test(t) ? "Shopping" : catHit ? catHit[0] : null;
    if (/wofür|wo\s*für|kategorie|wo\s+ist\s+.*geld|für was/.test(t) || (catWord && /ausgegeben|ausgeben|verbraucht|kost/.test(t))) {
      const cats = Object.entries(m.cats).sort((x, y) => y[1] - x[1]);
      if (catWord) { assistantSay(`Für ${catWord} hast du ${mName} ${eur(m.cats[catWord] || 0)} ausgegeben.`); return true; }
      finCard("Ausgaben " + mName + " · " + eur(m.out), cats.map(([c, v]) => `${c}: ${eur(v)}`));
      assistantSay(`${mName[0].toUpperCase() + mName.slice(1)} hast du ${eur(m.out)} ausgegeben. Am meisten für ${cats.slice(0, 3).map(([c, v]) => `${c} ${eur(v)}`).join(", ")}.`);
      return true;
    }
    // Nur Kontostand
    if (/kontostand|guthaben|wie\s*viel\s+geld\s+hab|was\s+ist\s+auf\s+(meinem|dem)\s+konto/.test(t) && !/monat|ausgab|einnahm/.test(t)) {
      assistantSay(`Auf deinem Konto sind gerade ${eur(a.balance)}${a.balance < 0 ? " im Minus" : ""}.`);
      return true;
    }
    // Überblick
    const rest = m.inc - m.out;
    const lines = [
      `Kontostand: ${a.balance < 0 ? "−" : ""}${eur(a.balance)}`,
      `${monthName(which)}: rein ${eur(m.inc)} · raus ${eur(m.out)} · ${rest >= 0 ? "übrig" : "Minus"} ${eur(rest)}`,
    ];
    if (a.months[a.prev] && which === a.cur) lines.push(`${monthName(a.prev)}: rein ${eur(a.months[a.prev].inc)} · raus ${eur(a.months[a.prev].out)}`);
    if (a.incomeSum) lines.push(`Regelmäßige Eingänge: ${a.income.slice(0, 3).map(x => `${x.name} ${eur(x.amount)}`).join(", ")}`);
    if (a.fixedSum) lines.push(`Fixkosten: ${eur(a.fixedSum)} im Monat (${a.fixed.length} Posten)`);
    const topCats = Object.entries(m.cats).sort((x, y) => y[1] - x[1]).slice(0, 4);
    if (topCats.length) lines.push("Größte Ausgaben: " + topCats.map(([c, v]) => `${c} ${eur(v)}`).join(", "));
    finCard("Finanzen · " + monthName(which), lines);
    let say = `Dein Kontostand ist ${eur(a.balance)}${a.balance < 0 ? " im Minus" : ""}. ${mName[0].toUpperCase() + mName.slice(1)} sind ${eur(m.inc)} reingekommen und ${eur(m.out)} rausgegangen`;
    say += rest >= 0 ? `, also ${eur(rest)} übrig.` : `, also ${eur(rest)} mehr ausgegeben als eingenommen.`;
    if (a.fixedSum) say += ` Deine Fixkosten liegen bei etwa ${eur(a.fixedSum)} im Monat.`;
    if (topCats.length) say += ` Am meisten ging für ${topCats[0][0]} raus, ${eur(topCats[0][1])}.`;
    assistantSay(say);
    return true;
  }
