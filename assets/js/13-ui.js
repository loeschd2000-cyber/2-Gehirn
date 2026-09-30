  /* ================= Neue Bedienelemente (Menü, Tastatur, Vorschläge) ================= */
  const closeDrawers = () => document.body.classList.remove("open-l", "open-r");
  $("openL").onclick = () => { document.body.classList.remove("open-r"); document.body.classList.add("open-l"); };
  $("openR").onclick = () => { document.body.classList.remove("open-l"); document.body.classList.add("open-r"); };
  $("scrim").onclick = closeDrawers;
  document.querySelectorAll("[data-close]").forEach(b => b.onclick = closeDrawers);
  list.addEventListener("click", e => { if (e.target.closest(".open")) closeDrawers(); });
  $("cNew").addEventListener("click", closeDrawers);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDrawers(); });
  $("kbBtn").onclick = () => {
    const app = $("app"), hidden = app.classList.toggle("kb-hidden");
    $("kbBtn").classList.toggle("on", !hidden);
    if (!hidden) setTimeout(() => input.focus(), 50);
  };
  $("newBtn").onclick = () => $("cNew").click();
  $("chips").addEventListener("click", e => {
    const c = e.target.closest(".chip"); if (!c || busy) return;
    input.value = c.textContent; $("form").requestSubmit();
  });
  if (!MINI) $("orbwrap").addEventListener("click", () => micBtn.click());


  /* ================= Start-Sequenz, Partikel, Info-Kacheln ================= */
  function bootSequence() {
    const boot = $("boot");
    if (MINI || reduce || sessionStorage.getItem("zg_booted")) { boot.classList.add("done"); return; }
    try { sessionStorage.setItem("zg_booted", "1"); } catch {}
    const steps = ["Kern wird gestartet", "Sprachmodul", "Gedächtnis", "Verbindungen", "Alle Systeme"];
    let i = 0;
    const tick = () => {
      if (i < steps.length) {
        const d = document.createElement("div"); d.innerHTML = `› ${steps[i]} … <b>${i === steps.length - 1 ? "ONLINE" : "OK"}</b>`;
        $("bootLines").append(d); $("bootBar").style.width = ((i + 1) / steps.length * 100) + "%";
        i++; setTimeout(tick, 230);
      } else setTimeout(() => boot.classList.add("done"), 350);
    };
    setTimeout(tick, 250);
  }
  function spawnMotes() {
    if (MINI || reduce) return;
    const box = $("motes"), n = IS_ANDROID ? 14 : 22;
    for (let i = 0; i < n; i++) {
      const m = document.createElement("i");
      m.style.left = Math.random() * 100 + "%";
      m.style.animationDuration = (12 + Math.random() * 16) + "s";
      m.style.animationDelay = (-Math.random() * 20) + "s";
      const sz = 1.5 + Math.random() * 2.5; m.style.width = m.style.height = sz + "px";
      box.append(m);
    }
  }
  function renderTiles() {
    const box = $("tiles"); if (!box || MINI) return;
    box.textContent = "";
    const add = (ic, label, value, sub, cls, ask) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "tile";
      b.innerHTML = "<small></small><b></b>" + (sub ? "<em></em>" : "");
      b.children[0].textContent = label; b.children[0].dataset.ic = ic; b.children[1].textContent = value;
      if (sub) { b.children[2].textContent = sub; if (cls) b.children[2].className = cls; }
      b.style.animationDelay = (box.children.length * 70) + "ms";
      b.onclick = () => { buzz(10); if (!busy) { input.value = ask; $("form").requestSubmit(); } };
      box.append(b);
    };
    const n = new Date();
    if (n.getHours() >= 19) {
      const done = chats.some(c => c.id === diaryId(n));
      add("📔", "Tagebuch", done ? "erledigt ✓" : "Wie war's?", done ? "Noch was ergänzen" : "Erzähl von deinem Tag", "", "Tagebuch");
    } else add("🗓", n.toLocaleDateString("de-DE", { weekday: "long" }), n.toLocaleDateString("de-DE", { day: "numeric", month: "short" }), "Was steht an?", "", "Was steht heute an?");
    // Konto (letzter Stand)
    try {
      if (AND && AND.bankCached) {
        const d = JSON.parse(AND.bankCached() || "null");
        if (d && d.ok) {
          const age = Math.round((Date.now() - d.fetched) / 3600000);
          add("🏦", "Konto", (d.balance < 0 ? "−" : "") + eur(d.balance).replace(" Euro", " €"), age < 1 ? "gerade eben" : `vor ${age} Std.`, "", "Zeig mir eine Statistik von meinem Konto");
        }
      }
    } catch {}
    // Wallet (letzter Stand)
    const w = wGet();
    if (w.addr && w.last) {
      const ch = w.last.change || 0;
      add("◎", "Phantom", eur(w.last.total).replace(" Euro", " €"), (ch >= 0 ? "▲ " : "▼ ") + eur(Math.abs(ch)).replace(" Euro", " €") + " / 24 h", ch >= 0 ? "up" : "down", "Wie sieht's aus in meiner Phantom Wallet?");
    } else if (w.addr) add("◎", "Phantom", "abrufen", "tippen", "", "Wie sieht's aus in meiner Phantom Wallet?");
    // Alexa-Wecker
    try {
      if (AND && AND.alexaAlarms) {
        const al = JSON.parse(AND.alexaAlarms() || "[]").sort((a, b) => a.at - b.at)[0];
        if (al) { const d = new Date(al.at); add("⏰", "Wecker", d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }), d.toLocaleDateString("de-DE", { weekday: "short" }) + " · Alexa", "", "Welche Wecker sind gestellt?"); }
      }
    } catch {}
    if (box.children.length < 4) add("✉", "Mails", "Posteingang", "Neue Mails?", "", "Hab ich neue Mails?");
    if (box.children.length < 4) add("♫", "Musik", "Spotify", "Weiter / Pause", "", "Spiel die Musik weiter");
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) renderTiles(); });


  /* ================= Oberfläche 2.0: Schalter, Status, Hilfe, Hinweise, Toasts ================= */
  // Karten-Zeilen „Name: Wert“ ordentlich als Tabelle zeigen
  function fillRows(body, lines) {
    body.classList.add("rows"); body.textContent = "";
    for (const ln of lines) {
      const m = /^([^:\n]{1,32}):\s+(.+)$/.exec(ln);
      const row = document.createElement("div");
      if (m && !/^\d/.test(m[1]) && !/https?$/.test(m[1])) {
        row.className = "kv" + (m[2].length > 24 ? " long" : "");
        const k = document.createElement("span"); k.className = "k"; k.textContent = m[1];
        const v = document.createElement("span"); v.className = "v"; v.textContent = m[2];
        row.append(k, v);
      } else { row.className = "ln"; row.textContent = ln; }
      body.append(row);
    }
  }

  // Kleine Meldung oben (verschwindet von selbst)
  function toast(text, icon = "✓", ms = 2600) {
    let box = $("toasts");
    if (!box) { box = document.createElement("div"); box.id = "toasts"; box.className = "toasts"; box.setAttribute("aria-live", "polite"); document.body.append(box); }
    const t = document.createElement("div"); t.className = "toast";
    const i = document.createElement("span"); i.className = "ti"; i.textContent = icon;
    const s = document.createElement("span"); s.textContent = text;
    t.append(i, s); box.append(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 400); }, ms);
  }

  // Schalter: „AN/AUS“-Text → echter Kippschalter
  function syncToggle(btn) { const em = btn.querySelector("em"); if (em) { btn.dataset.on = /^(AN|EIN)$/i.test(em.textContent.trim()) ? "1" : "0"; btn.setAttribute("aria-pressed", btn.dataset.on === "1"); } }
  document.querySelectorAll(".set.tog").forEach(b => {
    syncToggle(b);
    const em = b.querySelector("em"); if (em) new MutationObserver(() => syncToggle(b)).observe(em, { childList: true, characterData: true, subtree: true });
  });

  // Status-Zusammenfassung: eine Zeile statt fünf Kästen
  function syncStatus() {
    const dots = [...document.querySelectorAll(".status .dot")];
    const bad = dots.filter(d => d.classList.contains("bad")).length, warn = dots.filter(d => d.classList.contains("warn")).length;
    const box = $("sumDots"); box.textContent = "";
    dots.forEach(d => { const s = document.createElement("i"); s.className = d.className; box.append(s); });
    $("sumText").textContent = bad ? `${bad} Problem${bad > 1 ? "e" : ""}` : warn ? `${warn} Hinweis${warn > 1 ? "e" : ""}` : "Alles bereit";
    $("statusBox").dataset.level = bad ? "bad" : warn ? "warn" : "ok";
  }
  new MutationObserver(syncStatus).observe(document.querySelector(".status"), { attributes: true, subtree: true, attributeFilter: ["class"] });
  syncStatus();

  // Gespräche durchsuchen
  $("hSearch").addEventListener("input", () => renderList());

  // Sicherheit & Morgen-Hinweise (nur Android-App)
  if (AND && AND.appLockGet && !MINI) {
    $("secPanel").hidden = false;
    const lockUi = () => { $("cLockState").textContent = AND.appLockGet() ? "AN" : "AUS"; };
    const proUi = () => { $("cProState").textContent = lsGet("zg_pro_on") === "0" ? "AUS" : "AN"; };
    lockUi(); proUi();
    $("cLock").onclick = () => {
      const r = AND.appLockSet(!AND.appLockGet());
      if (r === "auth") { toast("Zum Ausschalten kurz bestätigen (Fingerabdruck oder PIN)", "🔒", 3500); return; }
      if (r !== "ok") { toast(r, "⚠", 5000); return; }
      lockUi(); toast(AND.appLockGet() ? "App-Sperre an: beim Öffnen Fingerabdruck oder PIN" : "App-Sperre aus", "🔒");
    };
    window.__zgLockChanged = () => { lockUi(); toast(AND.appLockGet() ? "App-Sperre an" : "App-Sperre aus", "🔒"); };
    $("cPro").onclick = () => { lsSet("zg_pro_on", lsGet("zg_pro_on") === "0" ? "1" : "0"); proUi(); proactiveSync(); toast(lsGet("zg_pro_on") === "0" ? "Morgen-Hinweise aus" : "Morgen-Hinweise an (7:30 Uhr)", "🔔"); };
  }

  // Unterbrechen mit „Hey Jarvis“ (Android)
  if (AND && AND.bargeInGet && !MINI) {
    $("cBarge").hidden = false;
    const bUi = () => { $("cBargeState").textContent = AND.bargeInGet() ? "AN" : "AUS"; };
    bUi();
    $("cBarge").onclick = () => { AND.bargeInSet(!AND.bargeInGet()); bUi(); toast(AND.bargeInGet() ? "Du kannst Jarvis jetzt mit „Hey Jarvis“ unterbrechen" : "Unterbrechen aus", "✋"); };
  }

  /* ---------- Ausklapp-Blatt (Hilfe, Neuigkeiten) ---------- */
  function openSheet(title, build) {
    closeDrawers();
    let sh = $("sheet");
    if (!sh) {
      sh = document.createElement("div"); sh.id = "sheet"; sh.className = "sheet";
      sh.innerHTML = '<div class="sheet-card" role="dialog" aria-modal="true"><div class="sheet-grip"></div><div class="sheet-head"><b></b><button class="ibtn" type="button" aria-label="Schließen"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div><div class="sheet-body"></div></div>';
      document.body.append(sh);
      sh.addEventListener("click", e => { if (e.target === sh) closeSheet(); });
      sh.querySelector(".sheet-head button").onclick = closeSheet;
    }
    sh.querySelector(".sheet-head b").textContent = title;
    const body = sh.querySelector(".sheet-body"); body.textContent = ""; body.scrollTop = 0;
    build(body);
    requestAnimationFrame(() => sh.classList.add("open"));
  }
  function closeSheet() { const sh = $("sheet"); if (sh) sh.classList.remove("open"); }
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });

  const HELP = [
    ["☀️", "Dein Tag", [["Guten Morgen", 1], ["Was steht heute an?", 1], ["Wie wird das Wetter morgen?", 1], ["Brauch ich heute eine Jacke?", 1]]],
    ["⏰", "Wecker, Timer, Erinnerungen", [["Stell den Wecker um 6 Uhr"], ["Stell einen Timer auf 10 Minuten"], ["Erinner mich morgen um 16 Uhr an die Hausaufgaben"], ["Welche Erinnerungen habe ich?", 1]]],
    ["🛒", "Listen", [["Setz Milch auf die Einkaufsliste"], ["Was steht auf der Einkaufsliste?", 1], ["Setz Mathe-Hausaufgaben auf meine To-dos"], ["Was steht auf meiner To-do-Liste?", 1]]],
    ["📅", "Kalender & Mails", [["Trag morgen um 10 Uhr Zahnarzt ein"], ["Welche Termine hab ich diese Woche?", 1], ["Hab ich neue Mails?", 1], ["Lies meine letzte Mail", 1]]],
    ["💬", "Nachrichten & Anrufe", [["Schreib Papa auf WhatsApp hallo"], ["Ruf Papa an"]]],
    ["🎵", "Musik", [["Spiel Gzuz"], ["Spiel die Musik weiter", 1], ["Nächstes Lied", 1], ["Pause", 1]]],
    ["💶", "Geld", [["Wie sieht's aus mit meinen Finanzen?", 1], ["Zeig mir eine Statistik von meinem Konto", 1], ["Was sind meine Fixkosten?", 1], ["Wie steht mein Budget?", 1], ["Setz mein Monatsbudget auf 600 Euro"], ["Wie sieht's aus in meiner Phantom Wallet?", 1], ["Sag mir Bescheid, wenn SOL unter 100 Dollar fällt"]]],
    ["🎓", "Schule & Lernen", [["Was hab ich morgen in der Schule?", 1], ["Wann ist die nächste Arbeit?", 1], ["Am 15. Oktober schreiben wir eine Arbeit in SPS"], ["Frag mich SPS ab"], ["Stundenplan Montag: SPS, Deutsch, Mathe"]]],
    ["🧠", "Gedächtnis", [["Merk dir, mein Ausbilder heißt Herr Müller"], ["Was weißt du über mich?", 1], ["Was hab ich über Lukas gesagt?"], ["Merk dir, Lukas hat am 12. März Geburtstag"]]],
    ["📔", "Tagebuch", [["Tagebuch", 1], ["Lies mir mein Tagebuch von gestern vor", 1], ["Erinner mich jeden Abend um 21:30 ans Tagebuch"]]],
    ["🗺", "Unterwegs", [["Navigier mich nach Hause"], ["Wie lange brauche ich nach Schweinfurt?"]]],
    ["🖥", "PC steuern (über den PC-Server)", [["Mach am PC leiser"], ["Nächstes Lied am PC"], ["Öffne Spotify am PC"], ["Sperr den PC"], ["Fahr den PC in 30 Minuten herunter"]]],
    ["💡", "Hilfe", [["Was kannst du?", 1]]],
    ["✨", "Einfach frei reden", [["Kannst du Brot auf die Liste setzen und mich um 7 wecken?"], ["Erklär mir, wie ein Schütz funktioniert", 1]]],
  ];
  function tryCommand(cmd, run) {
    closeSheet();
    if (run && !busy) { input.value = cmd; $("form").requestSubmit(); return; }
    // zum Anpassen ins Eingabefeld legen
    const app = $("app"); if (app.classList.contains("kb-hidden")) $("kbBtn").click();
    input.value = cmd; setTimeout(() => { input.focus(); input.setSelectionRange(cmd.length, cmd.length); }, 80);
    toast("Anpassen und senden – oder einfach sagen", "✎");
  }
  function openHelp() {
    openSheet("Was kann Jarvis?", body => {
      const p = document.createElement("p"); p.className = "sheet-intro";
      p.textContent = "Tipp einen Satz an: Fragen laufen sofort, Befehle landen zum Anpassen im Eingabefeld. Du kannst aber auch ganz normal reden – Jarvis versteht auch freie Sätze.";
      body.append(p);
      for (const [ic, name, cmds] of HELP) {
        const g = document.createElement("section"); g.className = "hgroup";
        const h = document.createElement("h3"); h.innerHTML = "<span></span>"; h.firstChild.textContent = ic; h.append(" " + name); g.append(h);
        const row = document.createElement("div"); row.className = "hcmds";
        for (const [c, run] of cmds) {
          const b = document.createElement("button"); b.type = "button"; b.className = "hcmd" + (run ? " run" : "");
          b.textContent = c; b.onclick = () => tryCommand(c, run); row.append(b);
        }
        g.append(row); body.append(g);
      }
    });
  }
  $("cHelp").onclick = openHelp;
  const HELP_RE = /^\W*(?:(?:hey\s+)?jarvis\W*)?(?:hilfe|help|was\s+kannst\s+du(?:\s+(?:alles|so))*|was\s+kann\s+ich\s+(?:dich\s+)?(?:alles\s+)?(?:fragen|sagen)|welche\s+befehle\s+(?:gibt\s+es|kennst\s+du)|zeig\s+(?:mir\s+)?(?:alle\s+)?befehle)\W*$/i;
  function handleHelp(text) {
    if (!HELP_RE.test(text)) return false;
    if (!MINI) openHelp();
    assistantSay("Ich kann dir den Tag zusammenfassen, Wecker, Timer und Erinnerungen stellen, Listen führen, Termine und Mails checken, WhatsApp schreiben, Musik steuern, dein Konto und deine Wallet zeigen, dich abfragen und dein Tagebuch schreiben. " + (MINI ? "Öffne die App, dann zeige ich dir alle Befehle." : "Ich habe dir alle Befehle zum Antippen aufgemacht."));
    return true;
  }

  const NEWS_V = "2.2";
  function openNews() {
    openSheet("Neu in Jarvis", body => {
      const items = [
        ["🚗", "Jarvis im Auto (Android Auto)", "Neu: Im Auto einfach „Hey Jarvis“ sagen – ohne Knopf. Antwort kommt über die Auto-Lautsprecher, dazu ein eigener Jarvis-Bildschirm in Android Auto. Einrichtung: siehe „Android Auto einrichten.md“ (einmal „Unbekannte Quellen“ erlauben)."],
        ["✨", "Frei reden", "Jarvis versteht jetzt auch freie Sätze und mehrere Wünsche auf einmal: „Setz Brot auf die Liste und weck mich um 7.“"],
        ["🔎", "Gedächtnis-Suche", "„Was hab ich über Lukas gesagt?“ – Jarvis durchsucht alle Gespräche und dein Tagebuch. Im Gespräche-Menü gibt es jetzt auch ein Suchfeld."],
        ["🔔", "Morgen-Hinweise", "Um 7:30 Uhr meldet sich Jarvis von selbst: Geburtstage, bald anstehende Arbeiten, Budget-Warnungen."],
        ["🔒", "Mehr Sicherheit", "App-Sperre mit Fingerabdruck (im Menü einschalten). Schlüssel und Tokens liegen jetzt verschlüsselt im Handy-Tresor. Auf dem Sperrbildschirm verrät Jarvis nichts Privates."],
        ["🎛", "Neues Menü", "Übersichtliche Schalter, eine Status-Zeile und „Was kann Jarvis?“ mit allen Befehlen zum Antippen."],
        ["🛠", "Viele Fehler behoben", "Genauere Befehlserkennung, keine hängenden Antworten mehr, stabilere Stimme und Spracherkennung."],
      ];
      for (const [ic, t, d] of items) {
        const r = document.createElement("div"); r.className = "news";
        const i = document.createElement("span"); i.className = "ni"; i.textContent = ic;
        const tx = document.createElement("div"); const b = document.createElement("b"); b.textContent = t; const s = document.createElement("p"); s.textContent = d; tx.append(b, s);
        r.append(i, tx); body.append(r);
      }
      const go = document.createElement("button"); go.type = "button"; go.className = "btn primary wide"; go.textContent = "Alle Befehle ansehen";
      go.onclick = openHelp; body.append(go);
    });
    lsSet("zg_news", NEWS_V);
  }
  $("cNews").onclick = openNews;
  function maybeShowNews() { if (!MINI && lsGet("zg_news") !== NEWS_V && chats.some(c => !c.hidden)) setTimeout(openNews, 1600); else if (!lsGet("zg_news")) lsSet("zg_news", NEWS_V); }

  /* ---------- Startseite: Begrüßung + Hinweise für heute ---------- */
  function headsUp() {
    const out = [], now = new Date();
    for (const b of birthdaysSoon(1)) out.push(["🎂", `${b.name} hat ${b.inDays ? "morgen" : "heute"} Geburtstag`, "Was weißt du über mich?"]);
    const day = 864e5, t0 = new Date(now); t0.setHours(12, 0, 0, 0);
    for (const x of dataGet("exams", [])) {
      const d = Math.round((new Date(x.date + "T12:00") - t0) / day);
      if (d >= 0 && d <= 3) out.push(["📝", `${x.kind || "Arbeit"}${x.subject ? " " + x.subject : ""} ${d === 0 ? "heute" : d === 1 ? "morgen" : "in " + d + " Tagen"}`, x.subject ? "Frag mich " + x.subject + " ab" : "Wann ist die nächste Arbeit?"]);
    }
    try {
      const bu = dataGet("budgets", { total: 0 });
      if (bu.total && AND && AND.bankCached) {
        const d = JSON.parse(AND.bankCached() || "null");
        if (d && d.ok) { const an = finAnalyze(d), m = an.months[an.cur]; const pct = m ? Math.round(m.out / bu.total * 100) : 0; if (pct >= 80) out.push(["💸", `Budget zu ${pct} % verbraucht`, "Wie steht mein Budget?"]); }
      }
    } catch {}
    try {
      if (AND && AND.reminderList) { const e0 = new Date(); e0.setHours(23, 59, 59); const r = JSON.parse(AND.reminderList() || "[]").filter(x => x.at <= +e0 && x.at > Date.now()).sort((a, b) => a.at - b.at)[0]; if (r) out.push(["⏰", `${new Date(r.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} ${r.text}`, "Welche Erinnerungen habe ich?"]); }
    } catch {}
    if (now.getHours() >= 19 && !chats.some(c => c.id === diaryId(now))) out.push(["📔", "Tagebuch für heute fehlt noch", "Tagebuch"]);
    return out.slice(0, 3);
  }
  function renderHello() {
    const box = $("hello"); if (!box || MINI) return;
    const h = new Date().getHours();
    $("helloT").textContent = (h < 5 ? "Gute Nacht" : h < 11 ? "Guten Morgen" : h < 18 ? "Hallo" : "Guten Abend") + ", Damian";
    const heads = $("heads"); heads.textContent = "";
    for (const [ic, t, ask] of headsUp()) {
      const b = document.createElement("button"); b.type = "button"; b.className = "head";
      const i = document.createElement("span"); i.textContent = ic; const s = document.createElement("span"); s.textContent = t;
      b.append(i, s); b.onclick = () => { buzz(10); if (!busy) { input.value = ask; $("form").requestSubmit(); } };
      heads.append(b);
    }
    $("core").classList.toggle("has-heads", heads.children.length >= 2);
    const help = document.createElement("button"); help.type = "button"; help.className = "head ghost";
    help.innerHTML = "<span>💡</span><span>Was kann ich sagen?</span>"; help.onclick = openHelp;
    heads.append(help);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) renderHello(); });

  /* ---------- Morgen-Hinweise ans Handy schicken (klingeln auch, wenn die App zu ist) ---------- */
  let proTimer = null;
  function proactiveSync() {
    if (!AND || !AND.proactiveSync || MINI) return;
    clearTimeout(proTimer);
    proTimer = setTimeout(() => {
      try {
        const snap = { on: lsGet("zg_pro_on") !== "0", h: 7, m: 30,
          birthdays: dataGet("birthdays", []).map(b => ({ name: b.name, d: b.d, m: b.m })),
          exams: dataGet("exams", []).filter(x => new Date(x.date + "T23:59") >= new Date()).map(x => ({ date: x.date, kind: x.kind || "Arbeit", subject: x.subject || "" })) };
        try { const d = JSON.parse((AND.bankCached && AND.bankCached()) || "null"); if (d && d.ok) snap.budget = { month: dayKey(new Date()).slice(0, 7), warns: budgetWarnings(finAnalyze(d)).filter(w => /Prozent|drüber/.test(w)) }; } catch {}
        AND.proactiveSync(JSON.stringify(snap));
      } catch {}
    }, 800);
  }
