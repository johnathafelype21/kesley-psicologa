document.addEventListener("DOMContentLoaded", () => {
  const TOTAL_FRAMES = 240;
  const FRAMES_DIR = "/landing/assets/frames/";
  const FRAME_PATHS = Array.from({ length: TOTAL_FRAMES }, (_, index) =>
    `${FRAMES_DIR}frame_${String(index).padStart(4, "0")}.webp`,
  );

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  const experience = document.getElementById("experience");
  const scrollTrack = document.getElementById("scrollTrack");
  const canvas = document.getElementById("heroCanvas");
  const ctx = canvas ? canvas.getContext("2d", { alpha: false, desynchronized: true }) : null;
  const cueProgress = document.getElementById("cueProgress");
  const steps = Array.from(document.querySelectorAll(".story-step"));
  const navLinks = Array.from(document.querySelectorAll("[data-step-nav]"));
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const decodedFrames = new Map();
  const decodePromises = new Map();
  const decodeQueue = [];
  const queuedForDecode = new Set();
  const warmedFrames = new Set();

  let activeDecodes = 0;
  let desiredFrame = 0;
  let lastDrawnFrame = -1;
  let currentStepIndex = -1;
  let scrollDirection = 1;
  let scrollRaf = 0;
  let drawRaf = 0;
  let resizeTimer = 0;
  let useCounter = 0;
  let warmStarted = false;
  let destroyed = false;

  document.documentElement.style.overflowX = "hidden";
  document.documentElement.style.overflowY = "auto";
  document.documentElement.style.touchAction = "pan-y";
  document.body.style.overflowX = "hidden";
  document.body.style.overflowY = "auto";
  document.body.style.touchAction = "pan-y";

  function isMobile() {
    return window.innerWidth <= 760;
  }

  function applyScrollLength() {
    const length = isMobile() ? "1400vh" : "1200vh";
    if (experience) experience.style.minHeight = length;
    if (scrollTrack) scrollTrack.style.height = length;
  }

  function getConfig() {
    if (isMobile()) {
      return {
        dpr: 1.15,
        decodeAhead: 7,
        decodeBehind: 3,
        decodeConcurrency: 2,
        decodedLimit: 11,
        warmConcurrency: 2,
      };
    }

    return {
      dpr: 1.55,
      decodeAhead: 12,
      decodeBehind: 5,
      decodeConcurrency: 4,
      decodedLimit: 20,
      warmConcurrency: 3,
    };
  }

  function splitTextIntoChars(element) {
    if (!element || element.dataset.splitDone) return;
    element.dataset.splitDone = "true";
    let globalCharIndex = 0;

    function processNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || "";
        if (!text.trim()) return document.createTextNode(text);

        const fragment = document.createDocumentFragment();
        text.split(/(\s+)/).forEach((word) => {
          if (!word) return;
          if (/^\s+$/.test(word)) {
            fragment.appendChild(document.createTextNode(" "));
            return;
          }

          const wordSpan = document.createElement("span");
          wordSpan.className = "word";
          for (const char of word) {
            const charSpan = document.createElement("span");
            charSpan.className = "char";
            charSpan.style.setProperty("--char-i", globalCharIndex++);
            charSpan.textContent = char;
            wordSpan.appendChild(charSpan);
          }
          fragment.appendChild(wordSpan);
        });
        return fragment;
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const clone = node.cloneNode(false);
        Array.from(node.childNodes).forEach((child) => clone.appendChild(processNode(child)));
        return clone;
      }

      return node.cloneNode(true);
    }

    const fullText = (element.textContent || "").replace(/\s+/g, " ").trim();
    if (!element.getAttribute("aria-label")) element.setAttribute("aria-label", fullText);

    const fragment = document.createDocumentFragment();
    Array.from(element.childNodes).forEach((child) => fragment.appendChild(processNode(child)));
    element.replaceChildren(fragment);
  }

  if (!prefersReducedMotion) {
    document.querySelectorAll(".section-title").forEach(splitTextIntoChars);
  }

  function getSourceWidth(source) {
    return source.width || source.naturalWidth || 0;
  }

  function getSourceHeight(source) {
    return source.height || source.naturalHeight || 0;
  }

  function closeSource(source) {
    if (source && typeof source.close === "function") {
      try {
        source.close();
      } catch {
        // Already closed in some WebViews.
      }
    }
  }

  function touchDecoded(index) {
    const entry = decodedFrames.get(index);
    if (entry) entry.lastUsed = ++useCounter;
  }

  function trimDecodedCache() {
    const { decodedLimit } = getConfig();
    if (decodedFrames.size <= decodedLimit) return;

    const protectedFrames = new Set([desiredFrame]);
    for (let distance = 1; distance <= 2; distance += 1) {
      protectedFrames.add(desiredFrame + distance * scrollDirection);
      protectedFrames.add(desiredFrame - distance * scrollDirection);
    }

    const candidates = Array.from(decodedFrames.entries())
      .filter(([index]) => !protectedFrames.has(index))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    while (decodedFrames.size > decodedLimit && candidates.length) {
      const [index, entry] = candidates.shift();
      closeSource(entry.source);
      decodedFrames.delete(index);
    }
  }

  async function decodeViaImageElement(index) {
    const img = new Image();
    img.decoding = "async";
    img.src = FRAME_PATHS[index];

    if (typeof img.decode === "function") {
      await img.decode();
    } else {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
    }

    return img;
  }

  async function fetchAndDecode(index) {
    const cached = decodedFrames.get(index);
    if (cached) {
      touchDecoded(index);
      return cached.source;
    }

    if (decodePromises.has(index)) return decodePromises.get(index);

    const promise = (async () => {
      let source;
      const response = await fetch(FRAME_PATHS[index], { cache: "force-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();

      if (typeof createImageBitmap === "function") {
        try {
          source = await createImageBitmap(blob);
        } catch {
          source = await decodeViaImageElement(index);
        }
      } else {
        source = await decodeViaImageElement(index);
      }

      if (destroyed) {
        closeSource(source);
        return source;
      }

      decodedFrames.set(index, { source, lastUsed: ++useCounter });
      trimDecodedCache();
      return source;
    })()
      .catch((error) => {
        console.error(`Falha ao preparar frame ${index}`, error);
        throw error;
      })
      .finally(() => decodePromises.delete(index));

    decodePromises.set(index, promise);
    return promise;
  }

  function queueFrame(index, urgent = false) {
    if (index < 0 || index >= TOTAL_FRAMES) return;
    if (decodedFrames.has(index) || decodePromises.has(index) || queuedForDecode.has(index)) return;

    queuedForDecode.add(index);
    if (urgent) decodeQueue.unshift(index);
    else decodeQueue.push(index);
  }

  function buildDecodeWindow(center) {
    const { decodeAhead, decodeBehind } = getConfig();
    const order = [center];
    const maxDistance = Math.max(decodeAhead, decodeBehind);

    for (let distance = 1; distance <= maxDistance; distance += 1) {
      if (distance <= decodeAhead) {
        const forward = center + distance * scrollDirection;
        if (forward >= 0 && forward < TOTAL_FRAMES) order.push(forward);
      }
      if (distance <= decodeBehind) {
        const backward = center - distance * scrollDirection;
        if (backward >= 0 && backward < TOTAL_FRAMES) order.push(backward);
      }
    }

    return order;
  }

  function reprioritizeDecodeQueue(center) {
    const windowOrder = buildDecodeWindow(center);
    const wanted = new Set(windowOrder);

    for (let index = decodeQueue.length - 1; index >= 0; index -= 1) {
      if (!wanted.has(decodeQueue[index])) {
        queuedForDecode.delete(decodeQueue[index]);
        decodeQueue.splice(index, 1);
      }
    }

    windowOrder.slice().reverse().forEach((index) => queueFrame(index, true));
    pumpDecodeQueue();
  }

  function pumpDecodeQueue() {
    if (destroyed) return;
    const { decodeConcurrency } = getConfig();

    while (activeDecodes < decodeConcurrency && decodeQueue.length) {
      const index = decodeQueue.shift();
      queuedForDecode.delete(index);
      if (decodedFrames.has(index) || decodePromises.has(index)) continue;

      activeDecodes += 1;
      fetchAndDecode(index)
        .then(() => {
          if (index === desiredFrame) scheduleDraw();
        })
        .catch(() => {})
        .finally(() => {
          activeDecodes -= 1;
          pumpDecodeQueue();
        });
    }
  }

  function buildWarmOrder(center) {
    const order = [];
    const used = new Set();

    for (let distance = 0; distance < TOTAL_FRAMES; distance += 1) {
      const forward = center + distance;
      const backward = center - distance;
      if (forward >= 0 && forward < TOTAL_FRAMES && !used.has(forward)) {
        used.add(forward);
        order.push(forward);
      }
      if (backward >= 0 && backward < TOTAL_FRAMES && !used.has(backward)) {
        used.add(backward);
        order.push(backward);
      }
    }

    return order;
  }

  async function warmOne(index) {
    if (warmedFrames.has(index) || decodedFrames.has(index) || decodePromises.has(index)) return;

    try {
      const response = await fetch(FRAME_PATHS[index], { cache: "force-cache" });
      if (response.ok) {
        await response.arrayBuffer();
        warmedFrames.add(index);
      }
    } catch {
      // Foreground decoder retries normally.
    }
  }

  function startNetworkWarmup() {
    if (warmStarted || destroyed) return;
    warmStarted = true;

    const order = buildWarmOrder(desiredFrame);
    const { warmConcurrency } = getConfig();
    let cursor = 0;

    const worker = async () => {
      while (!destroyed && cursor < order.length) {
        const index = order[cursor++];
        if (Math.abs(index - desiredFrame) <= 10) continue;
        await warmOne(index);
      }
    };

    for (let index = 0; index < warmConcurrency; index += 1) worker();
  }

  function drawFrame(index) {
    if (!ctx || !canvas) return false;
    const entry = decodedFrames.get(index);
    if (!entry) return false;

    const source = entry.source;
    const imgW = getSourceWidth(source);
    const imgH = getSourceHeight(source);
    if (!imgW || !imgH) return false;

    const width = canvas.width;
    const height = canvas.height;
    let drawW;
    let drawH;
    let offsetX;
    let offsetY;

    if (isMobile()) {
      // Keep essentially the whole cinematic frame inside the phone viewport.
      // This removes the guessed crop that was losing the butterfly mid-flight.
      const cinematicHeight = height * 0.62;
      const scale = Math.min(width / imgW, cinematicHeight / imgH) * 1.02;
      drawW = imgW * scale;
      drawH = imgH * scale;
      offsetX = (width - drawW) * 0.5;
      offsetY = height * 0.055 + (cinematicHeight - drawH) * 0.5;
    } else {
      const scale = Math.max(width / imgW, height / imgH);
      drawW = imgW * scale;
      drawH = imgH * scale;
      offsetX = (width - drawW) * 0.95;
      offsetY = (height - drawH) * 0.5;
    }

    ctx.fillStyle = "#F7F3EA";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "medium";
    ctx.drawImage(source, offsetX, offsetY, drawW, drawH);

    lastDrawnFrame = index;
    touchDecoded(index);
    return true;
  }

  function scheduleDraw() {
    if (destroyed || drawRaf) return;
    drawRaf = requestAnimationFrame(() => {
      drawRaf = 0;
      // Do not show a wrong nearby frame. Hold the last correct frame until the
      // exact requested frame has already been decoded and is ready to draw.
      drawFrame(desiredFrame);
    });
  }

  function resizeCanvas() {
    if (!canvas) return;
    const { dpr } = getConfig();
    const actualDpr = Math.min(window.devicePixelRatio || 1, dpr);
    const nextWidth = Math.max(1, Math.round(window.innerWidth * actualDpr));
    const nextHeight = Math.max(1, Math.round(window.innerHeight * actualDpr));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    scheduleDraw();
  }

  function getScrollProgress() {
    const scrollingElement = document.scrollingElement || document.documentElement;
    const top = scrollingElement.scrollTop || window.scrollY || 0;
    const max = Math.max(1, scrollingElement.scrollHeight - window.innerHeight);
    return Math.max(0, Math.min(1, top / max));
  }

  function frameFromProgress(progress) {
    return Math.min(TOTAL_FRAMES - 1, Math.max(0, Math.floor(progress * TOTAL_FRAMES)));
  }

  function updateActiveStep(progress) {
    if (!steps.length) return;
    const stepIndex = Math.min(steps.length - 1, Math.floor(progress * steps.length));

    if (stepIndex !== currentStepIndex) {
      currentStepIndex = stepIndex;
      steps.forEach((step, index) => step.classList.toggle("is-active", index === stepIndex));
      navLinks.forEach((link) => {
        const index = Number.parseInt(link.getAttribute("data-step-nav"), 10);
        link.classList.toggle("is-active", index === stepIndex);
      });
    }

    if (cueProgress) cueProgress.style.width = `${Math.round(progress * 100)}%`;
  }

  function syncFromScroll() {
    scrollRaf = 0;
    const progress = getScrollProgress();
    const nextFrame = frameFromProgress(progress);

    updateActiveStep(progress);

    if (nextFrame !== desiredFrame) {
      scrollDirection = Math.sign(nextFrame - desiredFrame) || scrollDirection;
      desiredFrame = nextFrame;
      reprioritizeDecodeQueue(desiredFrame);
    } else if (!decodedFrames.has(desiredFrame) && !decodePromises.has(desiredFrame)) {
      reprioritizeDecodeQueue(desiredFrame);
    }

    scheduleDraw();
  }

  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(syncFromScroll);
  }

  navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const raw = link.getAttribute("data-step-nav");
      if (raw === null) return;
      event.preventDefault();

      const stepIndex = Number.parseInt(raw, 10);
      const scrollingElement = document.scrollingElement || document.documentElement;
      const maxScroll = Math.max(1, scrollingElement.scrollHeight - window.innerHeight);
      const progress = steps.length > 1 ? stepIndex / (steps.length - 1) : 0;

      window.scrollTo({
        top: maxScroll * progress,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    });
  });

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      applyScrollLength();
      resizeCanvas();
      syncFromScroll();
    }, 80);
  }, { passive: true });
  window.addEventListener("orientationchange", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      applyScrollLength();
      resizeCanvas();
      syncFromScroll();
    }, 160);
  });
  window.addEventListener("pageshow", () => {
    applyScrollLength();
    resizeCanvas();
    syncFromScroll();
  });

  applyScrollLength();
  resizeCanvas();
  desiredFrame = frameFromProgress(getScrollProgress());
  updateActiveStep(getScrollProgress());
  queueFrame(desiredFrame, true);
  reprioritizeDecodeQueue(desiredFrame);

  fetchAndDecode(desiredFrame)
    .then(() => {
      scheduleDraw();
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(startNetworkWarmup, { timeout: 700 });
      } else {
        setTimeout(startNetworkWarmup, 350);
      }
    })
    .catch(() => setTimeout(startNetworkWarmup, 500));

  window.addEventListener("beforeunload", () => {
    destroyed = true;
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    if (drawRaf) cancelAnimationFrame(drawRaf);
    clearTimeout(resizeTimer);
    decodedFrames.forEach((entry) => closeSource(entry.source));
    decodedFrames.clear();
    decodeQueue.length = 0;
    queuedForDecode.clear();
  });
});