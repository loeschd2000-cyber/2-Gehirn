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
