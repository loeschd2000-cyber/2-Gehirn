  /* ================= Google (Kalender, Gmail, Kontakte) ================= */
  const G_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ];
  const gScopes = () => lsGet("zg_g_tasks") === "1" ? [...G_SCOPES, "https://www.googleapis.com/auth/tasks"] : G_SCOPES;   // Google Aufgaben nur, wenn eingeschaltet
  let gClientId = lsGet("zg_g_client") || lsGet("zg_cal_client") || (AND ? "android" : "");
  let gToken = null, gTokenExp = 0, tokenClient = null, contactsWarm = false;
  try { const t = JSON.parse(sessionStorage.getItem("zg_g_token") || "null"); if (t && t.exp > Date.now() + 60000) { gToken = t.token; gTokenExp = t.exp; } } catch {}

  function updateGoogleUi() {
    const live = gToken && Date.now() < gTokenExp;
    if (!gClientId) { setDot("gDot", "warn"); $("gV").textContent = "Nicht eingerichtet. Termine gehen per Klick, Mails und Kontakte noch nicht."; }
    else if (live) { setDot("gDot", "ok"); $("gV").textContent = "Verbunden: Kalender, Gmail, Kontakte"; }
    else { setDot("gDot", "warn"); $("gV").textContent = "Eingerichtet. Einmal auf „Google verbinden“ klicken."; }
    $("cGoogle").classList.toggle("alert", !live);
    updateStoreUi();
    $("cGoogle").querySelector("em").textContent = live ? "VERBUNDEN" : "VERBINDEN";
  }
  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise((res, rej) => {
      const sc = document.createElement("script");
      sc.src = "https://accounts.google.com/gsi/client"; sc.async = true;
      sc.onload = () => res(); sc.onerror = () => rej(new Error("Google-Anmeldung konnte nicht geladen werden (Internet?)"));
      document.head.append(sc);
    });
  }
  function tokenReceived(tok, seconds) {
    gToken = tok; gTokenExp = Date.now() + seconds * 1000;
    lsSet("zg_g_ok", "1");
    try { sessionStorage.setItem("zg_g_token", JSON.stringify({ token: gToken, exp: gTokenExp })); } catch {}
    updateGoogleUi();
    driveSync(true).then(() => { const c = chats.find(x => x.id === currentId); if (c && c.messages.length !== messages.length && !busy && !speaking) openChat(c); });
  }
  async function getToken(silent) {
    if (gToken && Date.now() < gTokenExp - 60000) return gToken;
    if (AND) {   // in der Android-App meldet die App selbst bei Google an
      return new Promise((res, rej) => {
        window.__zgGoogle = { emit(ev) { if (ev.token) { tokenReceived(ev.token, 50 * 60); res(gToken); } else rej(new Error(ev.error || "Google-Anmeldung fehlgeschlagen")); } };
        if (silent && AND.googleTokenSilent) AND.googleTokenSilent(gScopes().join(" ")); else AND.googleToken(gScopes().join(" "));
      });
    }
    if (!gClientId) throw new Error("Google ist noch nicht eingerichtet");
    await loadGis();
    if (!tokenClient) tokenClient = google.accounts.oauth2.initTokenClient({ client_id: gClientId, scope: gScopes().join(" "), callback: () => {} });
    return new Promise((res, rej) => {
      tokenClient.callback = r => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...gScopes())) note("Hinweis: Du hast nicht alle Google-Rechte erlaubt. Manche Funktionen gehen dann nicht.");
        gToken = r.access_token; gTokenExp = Date.now() + (r.expires_in || 3600) * 1000;
        try { sessionStorage.setItem("zg_g_token", JSON.stringify({ token: gToken, exp: gTokenExp })); } catch {}
        updateGoogleUi(); res(gToken);
        driveSync(true).then(() => { const c = chats.find(x => x.id === currentId); if (c && c.messages.length !== messages.length && !busy && !speaking) openChat(c); });
      };
      tokenClient.error_callback = e => rej(new Error(e && e.type === "popup_closed" ? "Anmeldefenster geschlossen" : "Anmeldung blockiert. Klick links auf „Google verbinden“."));
      tokenClient.requestAccessToken({ prompt: "" });
    });
  }
  async function gApi(url, opts = {}) {
    const token = await getToken();
    const r = await fetch(url, { ...opts, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opts.headers || {}) } });
    if (r.status === 401) { gToken = null; try { sessionStorage.removeItem("zg_g_token"); } catch {} updateGoogleUi(); throw new Error("Die Google-Anmeldung ist abgelaufen. Klick links auf „Google verbinden“."); }
    if (!r.ok) { let m = "Fehler " + r.status; try { m = (await r.json()).error.message; } catch {} throw new Error(m); }
    return r.status === 204 ? null : r.json();
  }
  $("cGoogle").onclick = async () => {
    if (!gClientId) { $("gSetup").hidden = false; $("gId").focus(); return; }
    gToken = null; tokenClient = null;
    try { await getToken(); note("Google ist verbunden: Kalender, Gmail und Kontakte."); } catch (e) { note("Google: " + e.message); }
  };
  $("gCancel").onclick = () => { $("gSetup").hidden = true; };
  $("gSave").onclick = async () => {
    const id = $("gId").value.trim();
    if (!/\.apps\.googleusercontent\.com$/.test(id)) { note("Die Client-ID muss auf .apps.googleusercontent.com enden."); return; }
    gClientId = id; tokenClient = null; lsSet("zg_g_client", id);
    $("gSetup").hidden = true; updateGoogleUi();
    try { await getToken(); note("Google ist verbunden. Sag zum Beispiel: Hab ich neue Mails?"); } catch (e) { note("Google: " + e.message); }
  };

  /* ---------- Google Drive: alle Chats als eine Datei, auf allen Geräten gleich ---------- */
  const DRIVE_NAME = "Zweites Gehirn Chats.json";
  let driveTimer = null, driveBusy = false;
  function driveReady() { return !!(gToken && Date.now() < gTokenExp - 30000); }
  function scheduleDriveSave() { if (!driveReady()) return; clearTimeout(driveTimer); driveTimer = setTimeout(() => driveSync(true), 1500); }
  async function driveFileId() {
    let id = lsGet("zg_drive_file");
    if (id) return id;
    const q = encodeURIComponent(`name='${DRIVE_NAME}' and trashed=false`);
    const r = await gApi(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`);
    id = r.files && r.files[0] && r.files[0].id || "";
    if (id) lsSet("zg_drive_file", id);
    return id;
  }
  async function driveSync(write) {
    if (!driveReady() || driveBusy) return;
    driveBusy = true;
    try {
      let id = await driveFileId();
      if (id) {
        let remote = null;
        try { remote = await gApi(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`); }
        catch (e) { if (/404|not found/i.test(e.message)) { lsSet("zg_drive_file", ""); id = ""; } else throw e; }
        if (remote) {
          const before = new Map(chats.map(c => [c.id, c.updated]));
          mergeInto(remote.chats, remote.deleted);
          saveLocal(); renderAll();
          for (const c of chats) if (before.get(c.id) !== c.updated) await uploadChat(c);   // Neues vom Handy auch in den PC-Ordner
        }
      }
      if (write || !id) {
        const body = JSON.stringify({ app: "zweites-gehirn", saved: Date.now(), chats, deleted: deleted.slice(-500) });
        if (id) {
          await gApi(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": "application/json; charset=UTF-8" }, body });
        } else {
          const b = "zg" + Math.random().toString(36).slice(2);
          const multipart = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: DRIVE_NAME, mimeType: "application/json" })}\r\n--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${body}\r\n--${b}--`;
          const r = await gApi("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + b }, body: multipart });
          if (r && r.id) lsSet("zg_drive_file", r.id);
        }
      }
    } catch (e) { note("Drive-Speicher: " + e.message); }
    finally { driveBusy = false; updateStoreUi(); }
  }

  const needGoogle = () => { assistantSay("Dafür muss Google erst verbunden sein. Die Anleitung liegt in deinem Ordner unter „Google einrichten“. Danach klickst du links auf „Google verbinden“."); return true; };
