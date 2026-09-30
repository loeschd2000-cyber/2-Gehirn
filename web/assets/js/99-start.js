  /* ================= Start ================= */
  (async () => {
    bootSequence(); spawnMotes(); renderTiles(); renderHello();
    updateLoopUi(); updatePauseUi(); updateGoogleUi(); refreshUi();
    renderChat();
    await initStore();
    renderTiles();   // jetzt mit geladenen Daten (Tagebuch-Status usw.)
    renderHello(); proactiveSync(); maybeShowNews(); pcPing();
    renderAll();   // beim Öffnen immer mit einem neuen Gespräch starten, alte stehen rechts unter „Gespräche“
    await checkAi();
    warmUp();
    if (AND) {
      wakeOn = AND.wakeOn();
      if (lsGet("zg_g_ok") === "1") getToken(true).catch(() => {});   // Drive-Abgleich ohne Nachfrage, falls schon erlaubt
      if (AND.consumeWake()) nativeWake();
      if (AND.consumeDiary && AND.consumeDiary()) setTimeout(() => startDiary(true), 1800);
      const q0 = AND.consumeAsk ? AND.consumeAsk() : "";
      if (q0) { let n = 0; const go = () => { if ((busy || listening) && n++ < 40) { setTimeout(go, 250); return; } ask(q0, true); }; setTimeout(go, 1500); }
    }
    if (MINI) startMiniWatch();
    $("cWakeState").textContent = wakeOn ? "AN" : "AUS";
    if (wakeOn && !AND) { lockScreen(); scheduleWake(800); }
  })();
