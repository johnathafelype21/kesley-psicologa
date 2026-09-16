document.addEventListener("DOMContentLoaded", () => {
  const TOTAL_FRAMES = 240;
  const FRAMES_DIR = "/landing/assets/frames/";
  const FRAME_PREFIX = "frame_";
  const FRAME_EXT = ".webp";

  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  const canvas = document.getElementById("heroCanvas");
  const ctx = canvas ? canvas.getContext("2d", { alpha: false, desynchronized: true }) : null;
  const stickyWrapper = document.getElementById("stickyWrapper");
  const scrollTrack = document.getElementById("scrollTrack");
  const cueProgress = document.getElementById("cueProgress");
  const steps = Array.from(document.querySelectorAll(".story-step"));
  const navLinks = Array.from(document.querySelectorAll("[data-step-nav]"));
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const FRAME_PATHS = Array.from({ length: TOTAL_FRAMES }, (_, index) => {
    const padIndex = String(index).padStart(4, "0");
    return `${FRAMES_DIR}${FRAME_PREFIX}${padIndex}${FRAME_EXT}`;
  });

  const frameCache = new Map();
  const activeLoads = new Map();
  let loadQueue = [];
  let queuedFrames = new Set();
  let wantedFrames = new Set();
  let desiredFrame = 0;
  let lastDrawnFrame = -1;
  let currentStepIndex = -1;
  let scrollDirection = 1;
  let renderRafId = 0;
  let useCounter = 0;
  let destroyed = false;
  let forceNextRedraw = true;

  document.documentElement.style.overflowX = "hidden";
  document.documentElement.style.overflowY = "auto";
  document.documentElement.style.height = "auto";
  document.documentElement.style.touchAction = "pan-y";
  document.body.style.overflowX = "hidden";
  document.body.style.overflowY = "auto";
  document.body.style.height = "auto";
  document.body.style.minHeight = "100%";
  document.body.style.touchAction = "pan-y";

  // Reduced-motion simplifies typography only. The scroll-controlled frame
  // sequence remains fully functional and still uses all 240 frames.
  if (prefersReducedMotion) {
    if (stickyWrapper) {
      stickyWrapper.style.position = "fixed";
      stickyWrapper.style.height = "100svh";
    }
  }

  function splitTextIntoChars(element) {
    if (!element || element.dataset.splitDone) return;
    element.dataset.splitDone = "true";

    let globalCharIndex = 0;

    function processNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (!text.trim()) return document.createTextNode(text);

        const words = text.split(/(\s+)/);
        const fragment = document.createDocumentFragment();

        words.forEach((word) => {
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
        Array.from(node.childNodes).forEach((child) => {
          clone.appendChild(processNode(child));
        });
        return clone;
      }

      return node.cloneNode(true);
    }

    const fullText = element.textContent.replace(/\s+/g, " ").trim();
    if (!element.getAttribute("aria-label")) {
      element.setAttribute("aria-label", fullText);
    }

    const fragment = document.createDocumentFragment();
    Array.from(element.childNodes).forEach((child) => {
      fragment.appendChild(processNode(child));
    });

    element.innerHTML = "";
    element.appendChild(fragment);
  }

  if (!prefersReducedMotion) {
    document.querySelectorAll(".section-title").forEach(splitTextIntoChars);
  }

  function getLoaderConfig() {
    const isMobile = window.innerWidth <= 760;
    return {
      ahead: isMobile ? 5 : 8,
      behind: isMobile ? 3 : 5,
      cacheLimit: isMobile ? 10 : 18,
      concurrency: isMobile ? 3 : 5,
    };
  }

  function isLoadedEntry(entry) {
    return Boolean(
      entry &&
        entry.state === "loaded" &&
        entry.img &&
        entry.img.complete &&
        entry.img.naturalWidth > 0,
    );
  }

  function touchEntry(entry) {
    if (entry) entry.lastUsed = ++useCounter;
  }

  function interpolateTrack(progress, points) {
    const clamped = Math.max(0, Math.min(1, progress));

    for (let index = 0; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      if (clamped < current.p || clamped > next.p) continue;

      const range = Math.max(0.0001, next.p - current.p);
      const local = (clamped - current.p) / range;
      return current.value + (next.value - current.value) * local;
    }

    return points[points.length - 1].value;
  }

  function getMobileFocus(progress) {
    // The viewport pans through the frame as the butterfly travels. The wider
    // mobile crop plus this focus curve keeps the butterfly inside the phone
    // viewport instead of locking the composition to one fixed horizontal crop.
    const focusX = interpolateTrack(progress, [
      { p: 0.0, value: 0.78 },
      { p: 0.16, value: 0.73 },
      { p: 0.34, value: 0.66 },
      { p: 0.52, value: 0.57 },
      { p: 0.7, value: 0.48 },
      { p: 0.86, value: 0.43 },
      { p: 1.0, value: 0.5 },
    ]);

    const focusY = interpolateTrack(progress, [
      { p: 0.0, value: 0.42 },
      { p: 0.35, value: 0.39 },
      { p: 0.7, value: 0.36 },
      { p: 1.0, value: 0.4 },
    ]);

    return { focusX, focusY };
  }

  function drawFrame(index, img) {
    if (!ctx || !canvas || !img || !img.complete || img.naturalWidth === 0) return false;

    const w = canvas.width;
    const h = canvas.height;
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;
    const isMobile = window.innerWidth <= 760;
    const progress = index / (TOTAL_FRAMES - 1);

    let scale;
    let offsetX;
    let offsetY;

    if (isMobile) {
      // A slightly wider crop than cover exposes more of the cinematic frame.
      // The background color fills the small vertical breathing area naturally.
      scale = Math.max(w / imgW, (h / imgH) * 0.82);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      const { focusX, focusY } = getMobileFocus(progress);
      offsetX = w * 0.5 - drawW * focusX;
      offsetY = h * 0.42 - drawH * focusY;
    } else {
      scale = Math.max(w / imgW, h / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      offsetX = (w - drawW) * 0.95;
      offsetY = (h - drawH) * 0.5;
    }

    const drawW = imgW * scale;
    const drawH = imgH * scale;

    // Clamp mobile panning so we never expose empty horizontal canvas.
    if (isMobile && drawW >= w) {
      offsetX = Math.min(0, Math.max(w - drawW, offsetX));
    }
    if (isMobile && drawH >= h) {
      offsetY = Math.min(0, Math.max(h - drawH, offsetY));
    }

    ctx.fillStyle = "#F7F3EA";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
    lastDrawnFrame = index;
    return true;
  }

  function findClosestLoadedFrame(index) {
    const exact = frameCache.get(index);
    if (isLoadedEntry(exact)) return { index, entry: exact };

    for (let offset = 1; offset < TOTAL_FRAMES; offset += 1) {
      const primary = index + offset * scrollDirection;
      if (primary >= 0 && primary < TOTAL_FRAMES) {
        const entry = frameCache.get(primary);
        if (isLoadedEntry(entry)) return { index: primary, entry };
      }

      const secondary = index - offset * scrollDirection;
      if (secondary >= 0 && secondary < TOTAL_FRAMES) {
        const entry = frameCache.get(secondary);
        if (isLoadedEntry(entry)) return { index: secondary, entry };
      }
    }

    return null;
  }

  function renderDesiredFrame(force = false) {
    const match = findClosestLoadedFrame(desiredFrame);
    if (!match) return;

    touchEntry(match.entry);
    if (!force && !forceNextRedraw && match.index === lastDrawnFrame) return;

    if (drawFrame(match.index, match.entry.img)) {
      forceNextRedraw = false;
    }
  }

  function scheduleCanvasRender(force = false) {
    if (destroyed) return;
    if (force) forceNextRedraw = true;
    if (renderRafId) return;

    renderRafId = requestAnimationFrame(() => {
      renderRafId = 0;
      renderDesiredFrame(forceNextRedraw);
    });
  }

  function resizeCanvas() {
    if (!canvas) return;

    const isMobile = window.innerWidth <= 760;
    const dprCap = isMobile ? 1.4 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const cssWidth = Math.max(1, window.innerWidth);
    const cssHeight = Math.max(1, window.innerHeight);
    const nextWidth = Math.round(cssWidth * dpr);
    const nextHeight = Math.round(cssHeight * dpr);

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      forceNextRedraw = true;
    }

    scheduleCanvasRender(true);
  }

  function cancelLoad(index) {
    const img = activeLoads.get(index);
    if (!img) return;

    img.onload = null;
    img.onerror = null;
    try {
      img.removeAttribute("src");
    } catch {
      // Safe no-op in older embedded WebViews.
    }

    activeLoads.delete(index);
    const entry = frameCache.get(index);
    if (entry && entry.state === "loading") frameCache.delete(index);
  }

  function disposeEntry(index) {
    const entry = frameCache.get(index);
    if (!entry || entry.state === "loading") return;

    if (entry.img) {
      entry.img.onload = null;
      entry.img.onerror = null;
      try {
        entry.img.removeAttribute("src");
      } catch {
        // Safe no-op in older embedded WebViews.
      }
    }

    frameCache.delete(index);
  }

  function trimCache() {
    const { cacheLimit } = getLoaderConfig();
    const loadedEntries = Array.from(frameCache.entries()).filter(([, entry]) =>
      isLoadedEntry(entry),
    );

    if (loadedEntries.length <= cacheLimit) return;

    const removable = loadedEntries
      .filter(([index]) => !wantedFrames.has(index) && index !== desiredFrame)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    let loadedCount = loadedEntries.length;
    for (const [index] of removable) {
      if (loadedCount <= cacheLimit) break;
      disposeEntry(index);
      loadedCount -= 1;
    }
  }

  function pumpLoadQueue() {
    if (destroyed) return;
    const { concurrency } = getLoaderConfig();

    while (activeLoads.size < concurrency && loadQueue.length > 0) {
      const index = loadQueue.shift();
      queuedFrames.delete(index);

      if (!wantedFrames.has(index)) continue;

      const existing = frameCache.get(index);
      if (isLoadedEntry(existing) || (existing && existing.state === "loading")) continue;
      if (existing && existing.state === "error") frameCache.delete(index);

      const img = new Image();
      const entry = { img, state: "loading", lastUsed: ++useCounter };
      frameCache.set(index, entry);
      activeLoads.set(index, img);
      img.decoding = "async";

      img.onload = () => {
        if (destroyed) return;

        activeLoads.delete(index);
        const currentEntry = frameCache.get(index);
        if (!currentEntry || currentEntry.img !== img) {
          pumpLoadQueue();
          return;
        }

        currentEntry.state = "loaded";
        touchEntry(currentEntry);

        // If a fallback was painted while the exact frame was downloading,
        // immediately replace it with the correct frame once ready.
        if (index === desiredFrame || lastDrawnFrame < 0) {
          scheduleCanvasRender(true);
        }

        trimCache();
        pumpLoadQueue();
      };

      img.onerror = () => {
        if (destroyed) return;

        activeLoads.delete(index);
        const currentEntry = frameCache.get(index);
        if (currentEntry && currentEntry.img === img) currentEntry.state = "error";
        console.error(`Falha ao carregar frame ${index}: ${FRAME_PATHS[index]}`);
        pumpLoadQueue();
      };

      img.src = FRAME_PATHS[index];
    }
  }

  function buildPriorityOrder(center) {
    const { ahead, behind } = getLoaderConfig();
    const order = [center];
    const maxDistance = Math.max(ahead, behind);

    for (let distance = 1; distance <= maxDistance; distance += 1) {
      if (distance <= ahead) {
        const forward = center + distance * scrollDirection;
        if (forward >= 0 && forward < TOTAL_FRAMES) order.push(forward);
      }

      if (distance <= behind) {
        const backward = center - distance * scrollDirection;
        if (backward >= 0 && backward < TOTAL_FRAMES) order.push(backward);
      }
    }

    return order;
  }

  function freeSlotForExactFrame(center) {
    const { concurrency } = getLoaderConfig();
    const exact = frameCache.get(center);
    if (isLoadedEntry(exact) || (exact && exact.state === "loading")) return;
    if (activeLoads.size < concurrency) return;

    const candidate = Array.from(activeLoads.keys())
      .filter((index) => index !== center)
      .sort((a, b) => Math.abs(b - center) - Math.abs(a - center))[0];

    if (candidate !== undefined) cancelLoad(candidate);
  }

  function updateLoadWindow(center) {
    const priorityOrder = buildPriorityOrder(center);
    const nextWantedFrames = new Set(priorityOrder);
    wantedFrames = nextWantedFrames;

    loadQueue = [];
    queuedFrames.clear();

    // Avoid load thrashing while scrolling continuously: only cancel requests
    // that are now far outside the useful neighborhood.
    const cancelDistance = window.innerWidth <= 760 ? 12 : 20;
    Array.from(activeLoads.keys()).forEach((index) => {
      if (Math.abs(index - center) > cancelDistance) cancelLoad(index);
    });

    freeSlotForExactFrame(center);

    priorityOrder.forEach((index) => {
      const entry = frameCache.get(index);
      if (isLoadedEntry(entry) || (entry && entry.state === "loading")) {
        touchEntry(entry);
        return;
      }

      if (!queuedFrames.has(index)) {
        loadQueue.push(index);
        queuedFrames.add(index);
      }
    });

    trimCache();
    pumpLoadQueue();
  }

  function getScrollProgress() {
    const scrollingElement = document.scrollingElement || document.documentElement;
    const scrollTop = scrollingElement.scrollTop || window.scrollY || 0;
    const scrollHeight = scrollingElement.scrollHeight;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
    const maxScroll = Math.max(1, scrollHeight - viewportHeight);
    return Math.max(0, Math.min(1, scrollTop / maxScroll));
  }

  function updateActiveStep(progress) {
    if (steps.length === 0) return;

    const stepIndex = Math.min(
      steps.length - 1,
      Math.max(0, Math.floor(progress * steps.length)),
    );

    if (stepIndex !== currentStepIndex) {
      currentStepIndex = stepIndex;

      steps.forEach((step, index) => {
        step.classList.toggle("is-active", index === stepIndex);
      });

      navLinks.forEach((link) => {
        const linkStep = parseInt(link.getAttribute("data-step-nav"), 10);
        link.classList.toggle("is-active", linkStep === stepIndex);
      });
    }

    if (cueProgress) cueProgress.style.width = `${Math.round(progress * 100)}%`;
  }

  function updateFromScroll() {
    const progress = getScrollProgress();
    const nextDesiredFrame = Math.min(
      TOTAL_FRAMES - 1,
      Math.max(0, Math.round(progress * (TOTAL_FRAMES - 1))),
    );

    updateActiveStep(progress);

    if (nextDesiredFrame !== desiredFrame) {
      scrollDirection = Math.sign(nextDesiredFrame - desiredFrame) || scrollDirection;
      desiredFrame = nextDesiredFrame;
      updateLoadWindow(desiredFrame);
      scheduleCanvasRender();
      return;
    }

    const entry = frameCache.get(desiredFrame);
    if (!isLoadedEntry(entry) && !(entry && entry.state === "loading")) {
      updateLoadWindow(desiredFrame);
    }
  }

  navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const stepNavAttr = link.getAttribute("data-step-nav");
      if (stepNavAttr === null || steps.length === 0) return;

      event.preventDefault();
      const stepIdx = parseInt(stepNavAttr, 10);
      const scrollingElement = document.scrollingElement || document.documentElement;
      const maxScroll = Math.max(1, scrollingElement.scrollHeight - window.innerHeight);
      const denominator = Math.max(1, steps.length - 1);
      const targetProgress = Math.max(0, Math.min(1, stepIdx / denominator));

      window.scrollTo({
        top: maxScroll * targetProgress,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    });
  });

  window.addEventListener("scroll", updateFromScroll, { passive: true });
  window.addEventListener("wheel", updateFromScroll, { passive: true });
  window.addEventListener("touchmove", updateFromScroll, { passive: true });
  window.addEventListener("resize", () => {
    resizeCanvas();
    updateLoadWindow(desiredFrame);
    updateFromScroll();
  });
  window.addEventListener("orientationchange", () => {
    setTimeout(() => {
      resizeCanvas();
      updateLoadWindow(desiredFrame);
      updateFromScroll();
    }, 150);
  });
  window.addEventListener("pageshow", () => {
    resizeCanvas();
    updateFromScroll();
  });

  resizeCanvas();
  const initialProgress = getScrollProgress();
  desiredFrame = Math.round(initialProgress * (TOTAL_FRAMES - 1));
  updateActiveStep(initialProgress);
  updateLoadWindow(desiredFrame);
  scheduleCanvasRender(true);

  // Frame 0 is also preloaded in HTML; touching it here ensures the loader
  // starts from the same source of truth as the complete 0..239 sequence.
  if (scrollTrack) scrollTrack.dataset.totalFrames = String(FRAME_PATHS.length);

  window.addEventListener("beforeunload", () => {
    destroyed = true;
    if (renderRafId) cancelAnimationFrame(renderRafId);
    Array.from(activeLoads.keys()).forEach(cancelLoad);
    frameCache.clear();
    loadQueue = [];
    queuedFrames.clear();
    wantedFrames.clear();
  });
});
