document.addEventListener("DOMContentLoaded", () => {
  const TOTAL = 240;
  const LAST = TOTAL - 1;
  const paths = Array.from({ length: TOTAL }, (_, i) =>
    `/landing/assets/frames/frame_${String(i).padStart(4, "0")}.webp`,
  );

  const experience = document.getElementById("experience");
  const track = document.getElementById("scrollTrack");
  const canvas = document.getElementById("heroCanvas");
  const ctx = canvas?.getContext("2d", { alpha: false, desynchronized: true });
  const cue = document.getElementById("cueProgress");
  const steps = [...document.querySelectorAll(".story-step")];
  const nav = [...document.querySelectorAll("[data-step-nav]")];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const blobs = new Array(TOTAL);
  const decoded = new Map();
  const decoding = new Map();
  const queue = [];
  const queued = new Set();

  let sourceW = 0;
  let sourceH = 0;
  let target = 0;
  let previousTarget = 0;
  let direction = 1;
  let activeStep = -1;
  let activeDecodes = 0;
  let drawRaf = 0;
  let scrollRaf = 0;
  let resizeTimer = 0;
  let useTick = 0;
  let ready = false;
  let destroyed = false;

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  const mobile = () => innerWidth <= 760;
  const cfg = () => mobile()
    ? { length: "620vh", dpr: 1, fetchers: 7, decoders: 2, ahead: 12, behind: 5, limit: 24, prime: 10 }
    : { length: "560vh", dpr: 1.25, fetchers: 10, decoders: 3, ahead: 16, behind: 7, limit: 30, prime: 12 };

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      html.frames-loading, html.frames-loading body { overflow: hidden !important; overscroll-behavior: none !important; }
      .frame-loader { position: fixed; inset: 0; z-index: 99999; display: grid; place-items: center; background: #f7f3ea; color: #1a1d1a; transition: opacity .35s ease, visibility .35s ease; }
      .frame-loader.is-hidden { opacity: 0; visibility: hidden; pointer-events: none; }
      .frame-loader__inner { width: min(360px, calc(100vw - 48px)); display: grid; grid-template-columns: 1fr auto; gap: 10px 14px; align-items: center; }
      .frame-loader__label, .frame-loader__percent { font: 500 12px/1.2 "Instrument Sans", sans-serif; letter-spacing: .08em; text-transform: uppercase; }
      .frame-loader__percent { font-variant-numeric: tabular-nums; }
      .frame-loader__bar { grid-column: 1 / -1; height: 3px; overflow: hidden; border-radius: 999px; background: rgba(26,29,26,.12); }
      .frame-loader__progress { display: block; width: 100%; height: 100%; transform: scaleX(0); transform-origin: left; background: #1a1d1a; transition: transform .08s linear; }
      @media (max-width: 760px) {
        .section-brand, .step-badge { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; box-shadow: none !important; }
        .char { filter: none !important; will-change: transform, opacity !important; }
        .hero-canvas { transform: none !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function splitText(el) {
    if (!el || el.dataset.splitDone || reduceMotion) return;
    el.dataset.splitDone = "1";
    let ci = 0;
    [...el.childNodes].forEach((node) => {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) return;
      const frag = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach((word) => {
        if (/^\s+$/.test(word)) return frag.appendChild(document.createTextNode(word));
        const w = document.createElement("span");
        w.className = "word";
        [...word].forEach((ch) => {
          const c = document.createElement("span");
          c.className = "char";
          c.style.setProperty("--char-i", ci++);
          c.textContent = ch;
          w.appendChild(c);
        });
        frag.appendChild(w);
      });
      node.replaceWith(frag);
    });
  }

  injectStyles();
  document.querySelectorAll(".title-line, .title-line--accent em").forEach(splitText);

  const loader = document.createElement("div");
  loader.className = "frame-loader";
  loader.innerHTML = `<div class="frame-loader__inner"><span class="frame-loader__label">Preparando experiência</span><span class="frame-loader__percent">0%</span><div class="frame-loader__bar"><span class="frame-loader__progress"></span></div></div>`;
  document.body.appendChild(loader);
  document.documentElement.classList.add("frames-loading");
  const loaderLabel = loader.querySelector(".frame-loader__label");
  const loaderPercent = loader.querySelector(".frame-loader__percent");
  const loaderProgress = loader.querySelector(".frame-loader__progress");

  function loading(percent, label) {
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    loaderPercent.textContent = `${p}%`;
    loaderProgress.style.transform = `scaleX(${p / 100})`;
    if (label) loaderLabel.textContent = label;
  }

  function unlock() {
    loader.classList.add("is-hidden");
    document.documentElement.classList.remove("frames-loading");
    setTimeout(() => loader.remove(), 450);
  }

  function applyLength() {
    const length = cfg().length;
    if (experience) experience.style.minHeight = length;
    if (track) track.style.height = length;
  }

  function resizeCanvas() {
    if (!canvas) return;
    const dpr = Math.min(devicePixelRatio || 1, cfg().dpr);
    const w = Math.max(1, Math.round(innerWidth * dpr));
    const h = Math.max(1, Math.round(innerHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    scheduleDraw();
  }

  function progress() {
    if (!experience) return 0;
    const range = Math.max(1, experience.offsetHeight - innerHeight);
    const local = (scrollY || document.documentElement.scrollTop || 0) - experience.offsetTop;
    return Math.max(0, Math.min(1, local / range));
  }

  function updateStep(p) {
    const index = Math.min(steps.length - 1, Math.floor(p * steps.length));
    if (index !== activeStep) {
      activeStep = index;
      steps.forEach((el, i) => el.classList.toggle("is-active", i === index));
      nav.forEach((el) => el.classList.toggle("is-active", Number(el.dataset.stepNav) === index));
    }
    if (cue) cue.style.width = `${Math.round(p * 100)}%`;
  }

  function sourceSize(source) {
    return { w: source.width || source.naturalWidth || 0, h: source.height || source.naturalHeight || 0 };
  }

  function closeSource(source) {
    try { source?.close?.(); } catch {}
  }

  function trim() {
    const limit = cfg().limit;
    if (decoded.size <= limit) return;
    const center = Math.round(target);
    const keep = new Set([Math.floor(target), Math.ceil(target), center]);
    for (let d = 1; d <= 3; d++) { keep.add(center + d); keep.add(center - d); }
    const candidates = [...decoded.entries()]
      .filter(([i]) => !keep.has(i))
      .sort((a, b) => a[1].used - b[1].used);
    while (decoded.size > limit && candidates.length) {
      const [i, entry] = candidates.shift();
      closeSource(entry.source);
      decoded.delete(i);
    }
  }

  async function loadImageFallback(blob) {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    try {
      if (img.decode) await img.decode();
      else await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
      return img;
    } finally { URL.revokeObjectURL(url); }
  }

  async function decodeFrame(index) {
    if (decoded.has(index)) return decoded.get(index).source;
    if (decoding.has(index)) return decoding.get(index);
    const promise = (async () => {
      const blob = blobs[index] || await fetchBlob(index);
      let source;
      if (typeof createImageBitmap === "function") {
        if (!sourceW || !sourceH) {
          const probe = await createImageBitmap(blob);
          sourceW = probe.width; sourceH = probe.height;
          probe.close();
        }
        const wantedW = mobile() ? Math.max(420, Math.round(innerWidth * 1.12)) : Math.max(1100, Math.round(innerWidth * 1.04));
        const w = Math.min(sourceW, wantedW);
        const h = Math.max(1, Math.round(w * sourceH / sourceW));
        source = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: "medium" });
      } else {
        source = await loadImageFallback(blob);
        if (!sourceW || !sourceH) { sourceW = source.naturalWidth; sourceH = source.naturalHeight; }
      }
      decoded.set(index, { source, used: ++useTick });
      trim();
      return source;
    })().finally(() => decoding.delete(index));
    decoding.set(index, promise);
    return promise;
  }

  function enqueue(index, urgent = false) {
    if (index < 0 || index >= TOTAL || decoded.has(index) || decoding.has(index) || queued.has(index)) return;
    queued.add(index);
    urgent ? queue.unshift(index) : queue.push(index);
  }

  function prioritize() {
    if (!ready) return;
    queue.length = 0;
    queued.clear();
    const center = Math.round(target);
    const low = Math.floor(target);
    const high = Math.min(LAST, low + 1);
    enqueue(low);
    enqueue(high);
    const { ahead, behind } = cfg();
    for (let d = 1; d <= Math.max(ahead, behind); d++) {
      if (d <= ahead) enqueue(center + d * direction);
      if (d <= behind) enqueue(center - d * direction);
    }
    pump();
  }

  function pump() {
    if (!ready || destroyed) return;
    while (activeDecodes < cfg().decoders && queue.length) {
      const index = queue.shift();
      queued.delete(index);
      if (decoded.has(index) || decoding.has(index)) continue;
      activeDecodes++;
      decodeFrame(index)
        .then(scheduleDraw)
        .catch((err) => console.error(`Falha no frame ${index}`, err))
        .finally(() => { activeDecodes--; pump(); });
    }
  }

  function drawSource(source, alpha) {
    if (!ctx || !canvas || !source) return;
    const { w, h } = sourceSize(source);
    if (!w || !h) return;
    const cw = canvas.width, ch = canvas.height;
    let scale, dw, dh, x, y;
    if (mobile()) {
      const areaH = ch * .60;
      scale = Math.min(cw / w, areaH / h) * 1.015;
      dw = w * scale; dh = h * scale;
      x = (cw - dw) * .5;
      y = ch * .055 + (areaH - dh) * .5;
    } else {
      scale = Math.max(cw / w, ch / h);
      dw = w * scale; dh = h * scale;
      x = (cw - dw) * .95;
      y = (ch - dh) * .5;
    }
    ctx.globalAlpha = alpha;
    ctx.drawImage(source, x, y, dw, dh);
  }

  function nearest(index) {
    if (decoded.has(index)) return [index, decoded.get(index)];
    for (let d = 1; d <= cfg().limit; d++) {
      const a = index + d * direction, b = index - d * direction;
      if (decoded.has(a)) return [a, decoded.get(a)];
      if (decoded.has(b)) return [b, decoded.get(b)];
    }
    return null;
  }

  function render() {
    if (!ctx || !canvas) return;
    const low = Math.floor(target);
    const high = Math.min(LAST, low + 1);
    const mix = target - low;
    const a = decoded.get(low);
    const b = decoded.get(high);
    ctx.save();
    ctx.fillStyle = "#F7F3EA";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = mobile() ? "low" : "medium";
    if (a && b && high !== low) {
      drawSource(a.source, 1);
      if (mix > .01) drawSource(b.source, mix);
      a.used = ++useTick; b.used = ++useTick;
    } else if (a) {
      drawSource(a.source, 1); a.used = ++useTick;
    } else if (b) {
      drawSource(b.source, 1); b.used = ++useTick;
    } else {
      const fallback = nearest(Math.round(target));
      if (fallback) { drawSource(fallback[1].source, 1); fallback[1].used = ++useTick; }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function scheduleDraw() {
    if (drawRaf || destroyed) return;
    drawRaf = requestAnimationFrame(() => { drawRaf = 0; render(); });
  }

  function syncScroll() {
    const p = progress();
    previousTarget = target;
    target = p * LAST;
    if (Math.abs(target - previousTarget) > .001) direction = target > previousTarget ? 1 : -1;
    updateStep(p);
    prioritize();
    scheduleDraw();
  }

  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; syncScroll(); });
  }

  async function fetchBlob(index, attempts = 2) {
    let error;
    for (let attempt = 0; attempt <= attempts; attempt++) {
      try {
        const res = await fetch(paths[index], { cache: attempt ? "reload" : "force-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!blob.size) throw new Error("arquivo vazio");
        blobs[index] = blob;
        return blob;
      } catch (err) { error = err; }
    }
    throw error;
  }

  function orderFrom(center) {
    const result = [], used = new Set();
    for (let d = 0; d < TOTAL; d++) {
      for (const i of [center + d, center - d]) {
        if (i >= 0 && i < TOTAL && !used.has(i)) { used.add(i); result.push(i); }
      }
    }
    return result;
  }

  async function preloadAll(center) {
    const order = orderFrom(center);
    let cursor = 0, done = 0;
    const workers = Array.from({ length: cfg().fetchers }, async () => {
      while (cursor < order.length) {
        const index = order[cursor++];
        await fetchBlob(index);
        done++;
        loading(done / TOTAL * 92, "Carregando os 240 frames");
      }
    });
    await Promise.all(workers);
  }

  async function prime(center) {
    const indexes = [];
    const rounded = Math.round(center);
    for (let d = 0; d <= cfg().prime; d++) {
      const f = rounded + d, b = rounded - d;
      if (f >= 0 && f < TOTAL) indexes.push(f);
      if (d <= 3 && b >= 0 && b < TOTAL && b !== f) indexes.push(b);
    }
    let cursor = 0, done = 0;
    const workers = Array.from({ length: cfg().decoders }, async () => {
      while (cursor < indexes.length) {
        await decodeFrame(indexes[cursor++]);
        done++;
        loading(92 + done / indexes.length * 8, "Preparando animação suave");
      }
    });
    await Promise.all(workers);
  }

  nav.forEach((link) => link.addEventListener("click", (event) => {
    const raw = link.dataset.stepNav;
    if (raw == null || !experience) return;
    event.preventDefault();
    const p = steps.length > 1 ? Number(raw) / (steps.length - 1) : 0;
    const top = experience.offsetTop + (experience.offsetHeight - innerHeight) * p;
    scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
  }));

  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { applyLength(); resizeCanvas(); syncScroll(); }, 100);
  }, { passive: true });
  addEventListener("orientationchange", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { applyLength(); resizeCanvas(); syncScroll(); }, 180);
  });

  async function boot() {
    applyLength();
    resizeCanvas();
    const p = progress();
    target = previousTarget = p * LAST;
    updateStep(p);
    try {
      await preloadAll(Math.round(target));
      ready = true;
      await prime(target);
      prioritize();
      scheduleDraw();
      loading(100, "Pronto");
      requestAnimationFrame(() => requestAnimationFrame(unlock));
    } catch (err) {
      console.error("Falha ao preparar sequência", err);
      ready = true;
      prioritize();
      loading(100, "Continuando");
      setTimeout(unlock, 300);
    }
  }

  boot();

  addEventListener("beforeunload", () => {
    destroyed = true;
    if (drawRaf) cancelAnimationFrame(drawRaf);
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    clearTimeout(resizeTimer);
    decoded.forEach((entry) => closeSource(entry.source));
    decoded.clear();
  });
});
