  /* ---------- Phantom Wallet (Solana): „Wie sieht's aus in meiner Phantom Wallet?“ ---------- */
  // Braucht nur die ÖFFENTLICHE Adresse – damit kann man nur nachschauen, nichts bewegen.
  const W_KEY = "zg_wallet";
  const wGet = () => { try { return JSON.parse(lsGet(W_KEY) || "{}"); } catch { return {}; } };
  const wSet = o => lsSet(W_KEY, JSON.stringify(o));
  const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const RPCS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];
  function updateWalletUi() { const w = wGet(); $("cWalletState").textContent = w.addr ? "AN" : "EINRICHTEN"; }
  $("cWallet").onclick = () => {
    const w = wGet(); $("wAddr").value = w.addr || ""; $("wInv").value = w.invested ? String(w.invested).replace(".", ",") : "";
    $("wSetup").hidden = !$("wSetup").hidden; if (!$("wSetup").hidden) $("wAddr").focus();
  };
  $("wCancel").onclick = () => { $("wSetup").hidden = true; };
  $("wSave").onclick = () => {
    const addr = $("wAddr").value.trim();
    if (addr && !B58.test(addr)) { note("Das sieht nicht wie eine Solana-Adresse aus. Bitte in Phantom auf „Adresse kopieren“ tippen und einfügen."); return; }
    if (addr.split(/\s+/).length > 3) { note("Bitte nur die Adresse, niemals die Geheimwörter!"); return; }
    const inv = parseFloat($("wInv").value.replace(/\./g, "").replace(",", "."));
    wSet({ ...wGet(), addr, invested: isFinite(inv) && inv > 0 ? inv : 0 });
    $("wSetup").hidden = true; updateWalletUi();
    assistantSay(addr ? "Wallet gespeichert. Frag mich einfach: Wie sieht's aus in meiner Phantom Wallet?" : "Wallet entfernt.");
  };
  updateWalletUi();

  async function rpc(method, params) {
    let last;
    for (const url of RPCS) {
      try {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const j = await r.json();
        if (j.error) throw new Error(j.error.message || "RPC-Fehler");
        return j.result;
      } catch (e) { last = e; }
    }
    throw last || new Error("Solana nicht erreichbar");
  }
  async function walletReport(addr) {
    // 1) Bestände: SOL + alle Token (beide Token-Programme)
    const lamports = (await rpc("getBalance", [addr])).value;
    const holdings = { [SOL_MINT]: lamports / 1e9 };
    for (const prog of ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]) {
      try {
        const res = await rpc("getTokenAccountsByOwner", [addr, { programId: prog }, { encoding: "jsonParsed" }]);
        for (const a of res.value || []) {
          const info = a.account.data.parsed && a.account.data.parsed.info; if (!info) continue;
          const amt = info.tokenAmount.uiAmount || 0; if (amt <= 0) continue;
          holdings[info.mint] = (holdings[info.mint] || 0) + amt;
        }
      } catch {}
    }
    const mints = Object.keys(holdings);
    // 2) Preise (Jupiter) in Dollar + 24-h-Änderung
    const prices = {};
    for (let i = 0; i < mints.length; i += 50) {
      const r = await fetch("https://lite-api.jup.ag/price/v3?ids=" + mints.slice(i, i + 50).join(","));
      Object.assign(prices, await r.json());
    }
    // 3) Namen
    const names = {};
    try {
      const pricedMints = mints.filter(m => prices[m]);
      for (let i = 0; i < pricedMints.length; i += 50) {
        const r = await fetch("https://lite-api.jup.ag/tokens/v2/search?query=" + pricedMints.slice(i, i + 50).join(","));
        for (const t of await r.json()) names[t.id] = t.symbol || t.name;
      }
    } catch {}
    // 4) Dollar -> Euro
    let eur = 0.86;
    try { const r = await fetch("https://api.frankfurter.dev/v1/latest?from=USD&to=EUR"); const j = await r.json(); if (j.rates && j.rates.EUR) eur = j.rates.EUR; } catch {}
    const rows = [];
    let total = 0, change = 0;
    for (const m of mints) {
      const p = prices[m]; if (!p || !p.usdPrice) continue;
      const val = holdings[m] * p.usdPrice * eur;
      if (val < 0.5) continue;                                 // Staub und Spam-Token weglassen
      const pct = +p.priceChange24h || 0;
      const d = val - val / (1 + pct / 100);
      total += val; change += d;
      rows.push({ sym: m === SOL_MINT ? "SOL" : (names[m] || m.slice(0, 4) + "…"), amount: holdings[m], val, pct, d });
    }
    rows.sort((a, b) => b.val - a.val);
    return { total, change, rows };
  }
  const euro = v => v.toLocaleString("de-DE", { maximumFractionDigits: v < 10 ? 2 : 0, minimumFractionDigits: v < 10 ? 2 : 0 }) + " Euro";
  const signed = v => (v >= 0 ? "plus " : "minus ") + euro(Math.abs(v));
  // großzügig, weil die Spracherkennung „Phantom Wallet“ oft anders schreibt (Fantom, Wollet, Walled …)
  const WALLET_Q = /\b(ph|f)antom\w*|\b(w|v)all?e[td]t?\b|\bwollet\b|\bwie\s*viel\s+geld\s+hab|\bportfolio\b|\bkrypto\w*|\bcrypto\w*|\bmeine[nrm]?\s+(coins|solana)\b|\bkontostand\b/i;
  const WALLET_ASK = /\b(wie|was|stand|steht|sieht|plus|minus|gewinn|verlust|wert|viel|zeig\w*|check\w*|status|abrufen|hab|habe|drauf)\b/i;
  const WALLET_INV = /(?:ich\s+)?(?:habe|hab)\s+(?:insgesamt\s+)?(\d+(?:[.,]\d+)?)\s*(?:euro|€)\s+.*?(?:rein\w*|investiert|eingezahlt|gesteckt|eingesetzt)/i;
  async function handleWallet(text) {
    const inv = WALLET_INV.exec(text);
    if (inv && (WALLET_Q.test(text) || /merk|speicher/i.test(text))) {
      const v = parseFloat(inv[1].replace(",", "."));
      wSet({ ...wGet(), invested: v });
      assistantSay(`Gemerkt: Du hast ${euro(v)} reingesteckt. Ab jetzt sage ich dir, wie viel Plus oder Minus du damit machst.`);
      return true;
    }
    if (!WALLET_Q.test(text) || !WALLET_ASK.test(text)) return false;
    const w = wGet();
    if (!w.addr) { assistantSay("Ich kenne deine Wallet-Adresse noch nicht. Tippe im Menü auf Phantom Wallet und füge deine öffentliche Adresse ein. Niemals die Geheimwörter!"); return true; }
    busy = true; refreshUi();
    try {
      const r = await walletReport(w.addr);
      wSet({ ...wGet(), last: { total: r.total, change: r.change, ts: Date.now() } });
      busy = false; refreshUi();
      if (!r.rows.length) { assistantSay("In deiner Wallet finde ich gerade nichts mit einem Wert."); return true; }
      let say = `Deine Phantom Wallet ist gerade etwa ${euro(r.total)} wert. Seit gestern ${signed(r.change)}`;
      const base = r.total - r.change; if (base > 0) say += `, das sind ${Math.abs(r.change / base * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Prozent`;
      say += ".";
      if (w.invested) {
        const diff = r.total - w.invested;
        say += ` Gegenüber deinen eingezahlten ${euro(w.invested)} bist du insgesamt ${signed(diff)}, also ${Math.abs(diff / w.invested * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} Prozent.`;
      }
      const top = r.rows.slice(0, 3).map(x => `${x.sym} ${euro(x.val)}`).join(", ");
      say += ` Größte Posten: ${top}.`;
      const card = document.createElement("div"); card.className = "card";
      const b = document.createElement("b"); b.textContent = "Phantom Wallet · " + euro(r.total); card.append(b);
      const body = document.createElement("div"); body.className = "body";
      body.textContent = r.rows.slice(0, 10).map(x => `${x.sym}: ${x.amount.toLocaleString("de-DE", { maximumFractionDigits: 4 })} = ${euro(x.val)}  (24 h: ${x.pct >= 0 ? "+" : ""}${x.pct.toFixed(1)} %)`).join("\n");
      card.append(body); log.append(card); log.scrollTop = log.scrollHeight;
      assistantSay(say);
    } catch (e) {
      busy = false; refreshUi();
      assistantSay("Ich komme gerade nicht an die Wallet-Daten. " + (e.message || ""));
    }
    return true;
  }
