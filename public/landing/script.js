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
  const cueProgress = document.getElementById("cueProgress");
  const steps = Array.from(document.querySelectorAll(".story-step"));
  const navLinks = Array.from(document.querySelectorAll("[data-step-nav]"));

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const images = new Array(TOTAL_FRAMES);
  let targetProgress = 0;
  let currentProgress = 0;
  let lastDrawnFrame = -1;
  let currentStepIndex = -1;
  let rafId = 0;

  // Make absolutely sure the document itself remains scrollable in Lovable,
  // mobile Safari, Chrome and embedded preview contexts.
  document.documentElement.style.overflowX = "hidden";
  document.documentElement.style.overflowY = "auto";
  document.documentElement.style.height = "auto";
  document.body.style.overflowX = "hidden";
  document.body.style.overflowY = "auto";
  document.body.style.height = "auto";
  document.body.style.minHeight = "100%";
  document.documentElement.style.touchAction = "pan-y";
  document.body.style.touchAction = "pan-y";

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
          } else {
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
          }
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

  function drawFrame(img) {
    if (!ctx || !canvas || !img || !img.complete || img.naturalWidth === 0) return;

    const w = canvas.width;
    const h = canvas.height;
    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;
    const scale = Math.max(w / imgW, h / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const isMobile = window.innerWidth <= 760;
    const offsetX = isMobile ? (w - drawW) * 0.75 : (w - drawW) * 0.95;
    const offsetY = (h - drawH) * 0.5;

    ctx.fillStyle = "#F7F3EA";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
  }

  function findClosestLoadedImage(index) {
    if (images[index] && images[index].complete && images[index].naturalWidth > 0) {
      return images[index];
    }

    for (let offset = 1; offset < TOTAL_FRAMES; offset++) {
      const prev = index - offset;
      if (
        prev >= 0 &&
        images[prev] &&
        images[prev].complete &&
        images[prev].naturalWidth > 0
      ) {
        return images[prev];
      }

      const next = index + offset;
      if (
        next < TOTAL_FRAMES &&
        images[next] &&
        images[next].complete &&
        images[next].naturalWidth > 0
      ) {
        return images[next];
      }
    }

    return null;
  }

  function resizeCanvas() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);

    if (lastDrawnFrame >= 0) {
      const img = findClosestLoadedImage(lastDrawnFrame);
      if (img) drawFrame(img);
    }
  }

  function loadFrame(index) {
    if (images[index]) return images[index];

    const img = new Image();
    images[index] = img;
    img.decoding = "async";
    img.src = getFramePath(index);
    img.onload = () => {
      if (index === 0 && lastDrawnFrame < 0) {
        resizeCanvas();
        drawFrame(img);
        lastDrawnFrame = 0;
      }
    };
    img.onerror = () => {
      console.error(`Falha ao carregar frame ${index}: ${img.src}`);
    };

    return img;
  }

  function preloadFrames() {
    loadFrame(0);

    for (let i = 10; i < TOTAL_FRAMES; i += 10) {
      loadFrame(i);
    }

    // Stagger loading so the browser can paint and remain responsive.
    let nextIndex = 1;
    const loadBatch = () => {
      let loaded = 0;
      while (nextIndex < TOTAL_FRAMES && loaded < 12) {
        if (nextIndex % 10 !== 0) loadFrame(nextIndex);
        nextIndex += 1;
        loaded += 1;
      }

      if (nextIndex < TOTAL_FRAMES) {
        if ("requestIdleCallback" in window) {
          window.requestIdleCallback(loadBatch, { timeout: 500 });
        } else {
          setTimeout(loadBatch, 40);
        }
      }
    };

    loadBatch();
  }

  function getScrollProgress() {
    const scrollingElement = document.scrollingElement || document.documentElement;
    const scrollTop = scrollingElement.scrollTop || window.scrollY || 0;
    const scrollHeight = scrollingElement.scrollHeight;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
    const maxScroll = Math.max(1, scrollHeight - viewportHeight);
    return Math.max(0, Math.min(1, scrollTop / maxScroll));
  }

  function updateScrollProgress() {
    targetProgress = getScrollProgress();
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

  function tick() {
    if (!prefersReducedMotion) {
      currentProgress += (targetProgress - currentProgress) * 0.16;

      if (Math.abs(targetProgress - currentProgress) < 0.0001) {
        currentProgress = targetProgress;
      }

      const frameIndex = Math.min(
        TOTAL_FRAMES - 1,
        Math.max(0, Math.round(currentProgress * (TOTAL_FRAMES - 1))),
      );

      if (frameIndex !== lastDrawnFrame) {
        loadFrame(frameIndex);
        const img = findClosestLoadedImage(frameIndex);
        if (img) {
          drawFrame(img);
          lastDrawnFrame = frameIndex;
        }
      }

      updateActiveStep(currentProgress);
    } else {
      updateActiveStep(getScrollProgress());
    }

    rafId = requestAnimationFrame(tick);
  }

  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      const stepNavAttr = link.getAttribute("data-step-nav");
      if (stepNavAttr === null) return;
      e.preventDefault();

      const stepIdx = parseInt(stepNavAttr, 10);
      const scrollingElement = document.scrollingElement || document.documentElement;
      const maxScroll = Math.max(1, scrollingElement.scrollHeight - window.innerHeight);
      const targetY = stepIdx === 0 ? 0 : maxScroll;

      window.scrollTo({ top: targetY, behavior: prefersReducedMotion ? "auto" : "smooth" });
    });
  });

  // Native scroll is the source of truth. Wheel/touch listeners only refresh
  // progress; they never preventDefault, so scrolling cannot be blocked.
  window.addEventListener("scroll", updateScrollProgress, { passive: true });
  window.addEventListener("wheel", updateScrollProgress, { passive: true });
  window.addEventListener("touchmove", updateScrollProgress, { passive: true });
  window.addEventListener("resize", () => {
    resizeCanvas();
    updateScrollProgress();
  });
  window.addEventListener("orientationchange", () => {
    setTimeout(() => {
      resizeCanvas();
      updateScrollProgress();
    }, 150);
  });
  window.addEventListener("pageshow", updateScrollProgress);

  resizeCanvas();
  preloadFrames();
  updateScrollProgress();
  updateActiveStep(getScrollProgress());
  tick();

  window.addEventListener("beforeunload", () => {
    if (rafId) cancelAnimationFrame(rafId);
  });
});
