  /* ================= Kern-Animation (Reaktor) ================= */
  const cv = $("orb"), cx = cv.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const N = IS_ANDROID ? 220 : 340, pts = [];
  for (let i = 0; i < N; i++) { const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963; pts.push([Math.cos(th) * r, y, Math.sin(th) * r]); }
  const COLORS = { idle: [63, 214, 255], listen: [70, 245, 170], think: [255, 190, 80], speak: [120, 228, 255] };
  let rot = 0, energy = 0, spinA = 0, spinB = 0, col = [63, 214, 255].slice();
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  function draw() {
    const dpr = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) { requestAnimationFrame(draw); return; }
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, w, h);
    const st = document.body.dataset.st || "idle";
    const target = speaking ? 1 : listening ? .8 : busy ? .65 : .18;
    energy += (target - energy) * .06;
    const tc = COLORS[st] || COLORS.idle;
    for (let i = 0; i < 3; i++) col[i] += (tc[i] - col[i]) * .06;
    const t = performance.now() / 1000;
    const R = Math.min(w, h) * .40, ox = w / 2, oy = h / 2;
    const sp = reduce ? .2 : 1;
    rot += (.004 + energy * .012) * sp;
    spinA += (.0035 + energy * .02) * sp; spinB -= (.006 + energy * .03) * sp;

    // Glühen
    const g = cx.createRadialGradient(ox, oy, 0, ox, oy, R * 1.25);
    g.addColorStop(0, rgba(col, .30 + energy * .25)); g.addColorStop(.45, rgba(col, .10 + energy * .08)); g.addColorStop(1, rgba(col, 0));
    cx.fillStyle = g; cx.beginPath(); cx.arc(ox, oy, R * 1.25, 0, 7); cx.fill();

    // Äußerer Skalenring mit Strichen
    cx.save(); cx.translate(ox, oy); cx.rotate(spinA * .5);
    for (let i = 0; i < 90; i++) {
      const a = i / 90 * Math.PI * 2, long = i % 15 === 0, mid = i % 5 === 0;
      const r1 = R * .98, r2 = R * (long ? .90 : mid ? .93 : .95);
      cx.strokeStyle = rgba(col, long ? .85 : mid ? .45 : .22); cx.lineWidth = long ? 2 : 1;
      cx.beginPath(); cx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); cx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); cx.stroke();
    }
    cx.restore();

    // Bogen-Segmente (drehen gegenläufig)
    const arcs = (rad, width, rotv, segs, alpha) => {
      cx.save(); cx.translate(ox, oy); cx.rotate(rotv);
      cx.strokeStyle = rgba(col, alpha); cx.lineWidth = width; cx.lineCap = "round";
      for (const [s0, len] of segs) { cx.beginPath(); cx.arc(0, 0, rad, s0, s0 + len); cx.stroke(); }
      cx.restore();
    };
    cx.shadowColor = rgba(col, .8); cx.shadowBlur = 12;
    arcs(R * .84, 3, spinA, [[0, 1.1], [1.6, .5], [2.5, 1.4], [4.3, .9]], .75 + energy * .25);
    arcs(R * .77, 1.5, spinB, [[.4, .3], [1.2, 1.8], [3.6, .25], [4.2, 1.3]], .45 + energy * .3);
    cx.shadowBlur = 0;

    // Stimm-Welle (reagiert auf Zuhören/Sprechen)
    const amp = R * (.012 + energy * .07);
    cx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const a = i / 160 * Math.PI * 2;
      const n = Math.sin(a * 6 + t * 5.3) * .5 + Math.sin(a * 11 - t * 7.1) * .3 + Math.sin(a * 17 + t * 9.7) * .2;
      const rr = R * .69 + n * amp * (speaking || listening ? (0.6 + 0.4 * Math.abs(Math.sin(t * 3.1))) : .6);
      const x = ox + Math.cos(a) * rr, y = oy + Math.sin(a) * rr;
      i ? cx.lineTo(x, y) : cx.moveTo(x, y);
    }
    cx.closePath(); cx.strokeStyle = rgba(col, .55 + energy * .4); cx.lineWidth = 1.6;
    cx.shadowColor = rgba(col, 1); cx.shadowBlur = 10 + energy * 14; cx.stroke(); cx.shadowBlur = 0;

    // Punkt-Kugel
    const RS = R * .56 * (1 + energy * .04 * Math.sin(t * (speaking ? 9 : listening ? 6 : 3)));
    const cr = Math.cos(rot), sr = Math.sin(rot), ct = Math.cos(.4), stt = Math.sin(.4);
    for (const [x, y, z] of pts) {
      const x1 = x * cr + z * sr, z1 = -x * sr + z * cr, y2 = y * ct - z1 * stt, z2 = y * stt + z1 * ct, a = (z2 + 1.2) / 2.2;
      cx.fillStyle = `rgba(${(col[0] + (255 - col[0]) * a * .6) | 0},${(col[1] + (255 - col[1]) * a * .5) | 0},255,${.12 + a * .8})`;
      cx.beginPath(); cx.arc(ox + x1 * RS, oy + y2 * RS, .5 + a * 1.5, 0, 7); cx.fill();
    }

    // Kern
    const core = cx.createRadialGradient(ox, oy, 0, ox, oy, R * .22);
    core.addColorStop(0, `rgba(255,255,255,${.75 + energy * .25})`); core.addColorStop(.35, rgba(col, .55 + energy * .3)); core.addColorStop(1, rgba(col, 0));
    cx.fillStyle = core; cx.beginPath(); cx.arc(ox, oy, R * .22, 0, 7); cx.fill();

    // HUD-Beschriftung, die langsam um den Kern kreist
    if (!MINI && R > 60) {
      cx.save(); cx.translate(ox, oy); cx.rotate(-spinA * .25);
      cx.font = `600 ${Math.max(9, R * .075)}px "Chakra Petch", sans-serif`; cx.fillStyle = rgba(col, .75); cx.textAlign = "center";
      const labels = ["J.A.R.V.I.S", st === "listen" ? "AUDIO IN" : st === "think" ? "ANALYSE" : st === "speak" ? "AUDIO OUT" : "BEREIT", "KERN " + Math.round(60 + energy * 40) + "%"];
      labels.forEach((txt, k) => {
        cx.save(); cx.rotate(k * (Math.PI * 2 / 3) + .5);
        cx.translate(0, -R * 1.13);
        cx.fillText(txt, 0, 0);
        cx.restore();
      });
      cx.restore();
    }
    // kleine Markierungen oben/unten
    cx.fillStyle = rgba(col, .9);
    for (const s of [-1, 1]) { cx.beginPath(); cx.moveTo(ox - 5, oy + s * R * 1.04); cx.lineTo(ox + 5, oy + s * R * 1.04); cx.lineTo(ox, oy + s * R * .99); cx.closePath(); cx.fill(); }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
