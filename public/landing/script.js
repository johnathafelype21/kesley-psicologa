document.addEventListener("DOMContentLoaded", () => {
  const TOTAL_FRAMES = 240;
  const FRAMES_DIR = "assets/frames/";
  const FRAME_PREFIX = "frame_";
  const FRAME_EXT = ".webp";

  // Ensure page starts at top on refresh/navigation
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }

  const canvas = document.getElementById("heroCanvas");
  const ctx = canvas ? canvas.getContext("2d", { alpha: false }) : null;
  const cueProgress = document.getElementById("cueProgress");
  const steps = Array.from(document.querySelectorAll(".story-step"));
  const navLinks = Array.from(document.querySelectorAll("[data-step-nav]"));

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Frame Cache
  const images = new Array(TOTAL_FRAMES);
  let targetProgress = 0;
  let currentProgress = 0;
  let lastDrawnFrame = -1;
  let currentStepIndex = -1;

  // Split-text helper for kinetic typography
  function splitTextIntoChars(element) {
    if (!element || element.dataset.splitDone) return;
    element.dataset.splitDone = "true";

    let globalCharIndex = 0;

    function processNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (!text.trim()) {
          return document.createTextNode(text);
        }

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
      } else if (node.nodeType === Node.ELEMENT_NODE) {
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

  // Format frame filename: frame_0000.webp
  function getFramePath(index) {
    const padIndex = String(index).padStart(4, "0");
    return `${FRAMES_DIR}${FRAME_PREFIX}${padIndex}${FRAME_EXT}`;
  }

  // Canvas drawing with DPR & Right-aligned cover math
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

  // Find closest loaded image when scrubbing quickly
  function findClosestLoadedImage(index) {
    if (images[index] && images[index].complete) return images[index];

    for (let offset = 1; offset < TOTAL_FRAMES; offset++) {
      const prev = index - offset;
      if (prev >= 0 && images[prev] && images[prev].complete) return images[prev];
      const next = index + offset;
      if (next < TOTAL_FRAMES && images[next] && images[next].complete) return images[next];
    }
    return null;
  }

  // Canvas Resize handler
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

  // Preload priority frames first, then remainder in background
  function preloadFrames() {
    // 1. Initial frame 0 (instant first paint)
    const initialImg = new Image();
    initialImg.src = getFramePath(0);
    initialImg.onload = () => {
      images[0] = initialImg;
      resizeCanvas();
      drawFrame(initialImg);
      lastDrawnFrame = 0;
    };

    // 2. Load keyframes every 10 frames for immediate responsiveness
    for (let i = 10; i < TOTAL_FRAMES; i += 10) {
      const img = new Image();
      img.src = getFramePath(i);
      img.onload = () => {
        images[i] = img;
      };
    }

    // 3. Progressive background load of all remaining frames
    for (let i = 1; i < TOTAL_FRAMES; i++) {
      if (!images[i]) {
        const img = new Image();
        img.src = getFramePath(i);
        img.onload = () => {
          images[i] = img;
        };
      }
    }
  }

  // Robust Scroll Progress Calculation across all browsers & devices
  function getScrollProgress() {
    const doc = document.documentElement;
    const body = document.body;
    const scrollTop = window.pageYOffset || doc.scrollTop || body.scrollTop || 0;
    const scrollHeight = Math.max(doc.scrollHeight, body.scrollHeight);
    const clientHeight = window.innerHeight || doc.clientHeight || 1;
    const maxScroll = Math.max(1, scrollHeight - clientHeight);

    return Math.max(0, Math.min(1, scrollTop / maxScroll));
  }

  function updateScrollProgress() {
    if (prefersReducedMotion) return;
    targetProgress = getScrollProgress();
  }

  // Active Narrative Step Sync (2 clean stages)
  function updateActiveStep(progress) {
    // 2 clean steps: [0..0.48] -> Início, [0.49..1.00] -> Autonomia
    const stepIndex = progress >= 0.48 ? 1 : 0;

    if (stepIndex !== currentStepIndex) {
      currentStepIndex = stepIndex;

      steps.forEach((step, idx) => {
        if (idx === stepIndex) {
          step.classList.add("is-active");
        } else {
          step.classList.remove("is-active");
        }
      });

      navLinks.forEach((link) => {
        const linkStep = parseInt(link.getAttribute("data-step-nav"), 10);
        if (linkStep === stepIndex) {
          link.classList.add("is-active");
        } else {
          link.classList.remove("is-active");
        }
      });
    }

    if (cueProgress) {
      cueProgress.style.width = `${Math.round(progress * 100)}%`;
    }
  }

  // 60FPS Render Loop with buttery LERP
  function tick() {
    if (!prefersReducedMotion) {
      // Smooth linear interpolation (lerp)
      currentProgress += (targetProgress - currentProgress) * 0.14;

      const frameIndex = Math.min(
        TOTAL_FRAMES - 1,
        Math.max(0, Math.round(currentProgress * (TOTAL_FRAMES - 1))),
      );

      if (frameIndex !== lastDrawnFrame) {
        const img = findClosestLoadedImage(frameIndex);
        if (img) {
          drawFrame(img);
          lastDrawnFrame = frameIndex;
        }
      }

      updateActiveStep(currentProgress);
    }

    requestAnimationFrame(tick);
  }

  // Smooth scroll to step on nav link click
  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      const stepNavAttr = link.getAttribute("data-step-nav");
      if (stepNavAttr === null) return;
      e.preventDefault();

      const stepIdx = parseInt(stepNavAttr, 10);

      if (prefersReducedMotion) {
        updateActiveStep(stepIdx);
        return;
      }

      const doc = document.documentElement;
      const scrollHeight = Math.max(doc.scrollHeight, document.body.scrollHeight);
      const maxScroll = Math.max(1, scrollHeight - window.innerHeight);

      const targetY = stepIdx === 0 ? 0 : maxScroll;

      window.scrollTo({
        top: targetY,
        behavior: "smooth",
      });
    });
  });

  // Passive event listeners for desktop and mobile touch
  window.addEventListener("scroll", updateScrollProgress, { passive: true });
  window.addEventListener("touchmove", updateScrollProgress, { passive: true });
  window.addEventListener("wheel", updateScrollProgress, { passive: true });
  window.addEventListener("resize", () => {
    resizeCanvas();
    updateScrollProgress();
  });

  window.addEventListener("load", () => {
    resizeCanvas();
    updateScrollProgress();
  });

  // Start engine
  resizeCanvas();
  preloadFrames();
  updateScrollProgress();
  updateActiveStep(0);
  tick();
});
