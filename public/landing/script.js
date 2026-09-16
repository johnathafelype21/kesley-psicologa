document.addEventListener("DOMContentLoaded", () => {
  const TOTAL_FRAMES = 240;
  const FRAMES_DIR = "/landing/assets/frames/";
  const FRAME_PREFIX = "frame_";
  const FRAME_EXT = ".webp";

  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  const canvas = document.getElementById("heroCanvas");
  const ctx = canvas ? canvas.getContext("2d", { alpha: false }) : null;
  const stickyWrapper = document.getElementById("stickyWrapper");
  const scrollTrack = document.getElementById("scrollTrack");
  const cueProgress = document.getElementById("cueProgress");
  const steps = Array.from(document.querySelectorAll(".story-step"));
  const navLinks = Array.from(document.querySelectorAll("[data-step-nav]"));
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  // Keep native scrolling as the only source of movement. Nothing here calls
  // preventDefault(), so mouse wheel, touchpad and touch remain browser-native.
  document.documentElement.style.overflowX = "hidden";
  document.documentElement.style.overflowY = "auto";
  document.documentElement.style.height = "auto";
  document.documentElement.style.touchAction = "pan-y";
  document.body.style.overflowX = "hidden";
  document.body.style.overflowY = "auto";
  document.body.style.height = "auto";
  document.body.style.minHeight = "100%";
  document.body.style.touchAction = "pan-y";

  // Windows/macOS reduced-motion should simplify text transitions, not disable
  // the scroll-controlled image sequence. Inline styles override the old CSS
  // fallback that shortened the track and turned the fixed canvas into sticky.
  if (prefersReducedMotion) {
    if (scrollTrack) scrollTrack.style.height = "220vh";
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

  function getFramePath(index) {
    const padIndex = String(index).padStart(4, "0");
    return `${FRAMES_DIR}${FRAME_PREFIX}${padIndex}${FRAME_EXT}`;
  }

  function getLoaderConfig() {
    const isMobile = window.innerWidth <= 760;
    return {
      radius: isMobile ? 3 : 6,
      cacheLimit: isMobile ? 10 : 20,
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

  function drawFrame(index, img) {
    if (!ctx || !canvas || !img || !img.complete || img.naturalWidth === 0) return false;

    const w = canvas.width;
    const h = canvas.height;
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;
    const scale = Math.max(w / imgW, h / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const isMobile = window.innerWidth <= 760;

    // Preserve the composition used by the original art direction while
    // keeping the butterfly/subject visible on narrow screens.
    const offsetX = isMobile ? (w - drawW) * 0.75 : (w - drawW) * 0.95;
    const offsetY = (h - drawH) * 0.5;

    ctx.fillStyle = "#F7F3EA";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
    lastDrawnFrame = index;
    return true;
  }

  function findClosestLoadedFrame(index) {
    const exact = frameCache.get(index);
    if (isLoadedEntry(exact)) {
      return { index, entry: exact };
    }

    for (let offset = 1; offset < TOTAL_FRAMES; offset += 1) {
      const first = index + offset * scrollDirection;
      if (first >= 0 && first < TOTAL_FRAMES) {
        const entry = frameCache.get(first);
        if (isLoadedEntry(entry)) return { index: first, entry };
      }

      const second = index - offset * scrollDirection;
      if (second >= 0 && second < TOTAL_FRAMES) {
        const entry = frameCache.get(second);
        if (isLoadedEntry(entry)) return { index: second, entry };
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
    const dprCap = isMobile ? 1.5 : 2;
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
      // Some embedded browsers do not allow removing an in-flight source.
    }

    activeLoads.delete(index);
    const entry = frameCache.get(index);
    if (entry && entry.state === "loading") {
      frameCache.delete(index);
    }
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
        // Safe no-op for older WebViews.
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
      const entry = {
        img,
        state: "loading",
        lastUsed: ++useCounter,
      };

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

        // Critical: if the exact frame finishes after a fallback was painted,
        // redraw it immediately. Never mark an unloaded target as displayed.
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
        if (currentEntry && currentEntry.img === img) {
          currentEntry.state = "error";
        }
        console.error(`Falha ao carregar frame ${index}: ${getFramePath(index)}`);
        pumpLoadQueue();
      };

      img.src = getFramePath(index);
    }
  }

  function buildPriorityOrder(center, radius) {
    const order = [center];

    for (let distance = 1; distance <= radius; distance += 1) {
      const ahead = center + distance * scrollDirection;
      const behind = center - distance * scrollDirection;

      if (ahead >= 0 && ahead < TOTAL_FRAMES) order.push(ahead);
      if (behind >= 0 && behind < TOTAL_FRAMES) order.push(behind);
    }

    return order;
  }

  function updateLoadWindow(center) {
    const { radius } = getLoaderConfig();
    const priorityOrder = buildPriorityOrder(center, radius);
    const nextWantedFrames = new Set(priorityOrder);
    wantedFrames = nextWantedFrames;

    // Cancel obsolete queued work. The queue is rebuilt below in the new
    // priority order, guaranteeing that the exact requested frame is first.
    loadQueue = [];
    queuedFrames.clear();

    // Cancel obsolete in-flight requests so the new exact frame gets a free
    // connection immediately instead of waiting behind frames far away.
    Array.from(activeLoads.keys()).forEach((index) => {
      if (!nextWantedFrames.has(index)) cancelLoad(index);
    });

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
    const stepIndex = progress >= 0.48 ? 1 : 0;

    if (stepIndex !== currentStepIndex) {
      currentStepIndex = stepIndex;

      steps.forEach((step, idx) => {
        step.classList.toggle("is-active", idx === stepIndex);
      });

      navLinks.forEach((link) => {
        const linkStep = parseInt(link.getAttribute("data-step-nav"), 10);
        link.classList.toggle("is-active", linkStep === stepIndex);
      });
    }

    if (cueProgress) {
      cueProgress.style.width = `${Math.round(progress * 100)}%`;
    }
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
      if (stepNavAttr === null) return;

      event.preventDefault();
      const stepIdx = parseInt(stepNavAttr, 10);
      const scrollingElement = document.scrollingElement || document.documentElement;
      const maxScroll = Math.max(1, scrollingElement.scrollHeight - window.innerHeight);
      const targetY = stepIdx === 0 ? 0 : maxScroll;

      window.scrollTo({
        top: targetY,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
    });
  });

  window.addEventListener("scroll", updateFromScroll, { passive: true });
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
  desiredFrame = Math.round(getScrollProgress() * (TOTAL_FRAMES - 1));
  updateActiveStep(getScrollProgress());
  updateLoadWindow(desiredFrame);
  scheduleCanvasRender(true);

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
