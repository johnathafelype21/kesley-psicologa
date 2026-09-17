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
  const header = document.querySelector(".hero-header");
  const steps = [...document.querySelectorAll(".story-step")];
  const navLinks = [...document.querySelectorAll(".section-nav .nav-link")];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Store ALL 240 frames permanently in memory for 100% fluid playback
  const frames = new Array(TOTAL);
  let loadingPromises = new Map();

  let targetFrame = 0;
  let currentFrame = 0;
  let activeStep = -1;
  let isTicking = false;
  let resizeTimer = 0;

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  const isMobile = () => window.innerWidth <= 760;
  // Compact, responsive hero scroll length for an immediate, seamless transition to content
  const cfg = () => isMobile()
    ? { length: "180vh", dpr: 1, concurrency: 8 }
    : { length: "200vh", dpr: 1.25, concurrency: 12 };

  function injectOptimizations() {
    const style = document.createElement("style");
    style.textContent = `
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

  function applyLength() {
    const length = cfg().length;
    if (experience) experience.style.minHeight = length;
    if (track) track.style.height = length;
  }

  function resizeCanvas() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, cfg().dpr);
    const w = Math.max(1, Math.round(window.innerWidth * dpr));
    const h = Math.max(1, Math.round(window.innerHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    draw(Math.round(currentFrame));
  }

  function progress() {
    if (!experience) return 0;
    const range = Math.max(1, experience.offsetHeight - window.innerHeight);
    const local = (window.scrollY || document.documentElement.scrollTop || 0) - experience.offsetTop;
    return Math.max(0, Math.min(1, local / range));
  }

  function updateStep(p) {
    // Step 1: 0.0 to 0.45, Step 2: 0.45 to 1.0
    const index = p < 0.45 ? 0 : 1;
    if (index !== activeStep) {
      activeStep = index;
      steps.forEach((el, i) => el.classList.toggle("is-active", i === index));
    }
    if (cue) cue.style.width = `${Math.round(p * 100)}%`;
  }

  function getAvailableFrame(index) {
    if (frames[index]) return frames[index];
    for (let d = 1; d < TOTAL; d++) {
      if (index - d >= 0 && frames[index - d]) return frames[index - d];
      if (index + d < TOTAL && frames[index + d]) return frames[index + d];
    }
    return null;
  }

  function draw(index) {
    if (!ctx || !canvas) return;
    const source = getAvailableFrame(index);
    if (!source) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const sw = source.width || source.naturalWidth || 1280;
    const sh = source.height || source.naturalHeight || 720;
    if (!sw || !sh) return;

    ctx.fillStyle = "#F7F3EA";
    ctx.fillRect(0, 0, cw, ch);

    const scale = Math.max(cw / sw, ch / sh);
    const dw = sw * scale;
    const dh = sh * scale;

    const aspect = cw / ch;
    const normProgress = Math.max(0, Math.min(1, index / LAST));

    let focalX, focalY;

    if (aspect <= 0.82) {
      focalX = 0.74 - normProgress * 0.38;
      focalY = 0.36 + normProgress * 0.08;
    } else if (aspect <= 1.25) {
      focalX = 0.84 - normProgress * 0.28;
      focalY = 0.42;
    } else {
      focalX = 0.95;
      focalY = 0.50;
    }

    const x = (cw - dw) * focalX;
    const y = (ch - dh) * focalY;

    ctx.drawImage(source, x, y, dw, dh);
  }

  function tick() {
    const diff = targetFrame - currentFrame;
    if (Math.abs(diff) > 0.01) {
      currentFrame += diff * 0.35;
      draw(Math.round(currentFrame));
      requestAnimationFrame(tick);
    } else {
      currentFrame = targetFrame;
      draw(Math.round(currentFrame));
      isTicking = false;
    }
  }

  // Update active navigation link based on current page scroll
  function updateNavActiveState() {
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const heroRange = experience ? (experience.offsetHeight - window.innerHeight) : 800;

    // Header glassmorphism background effect on scroll
    if (header) {
      header.classList.toggle("is-scrolled", scrollY > 60);
    }

    // Determine current active section
    let currentNav = "inicio";

    if (scrollY >= heroRange * 0.35 && scrollY < heroRange * 0.95) {
      currentNav = "transformacao";
    } else if (scrollY >= heroRange * 0.95) {
      const sections = ["espaco", "sobre", "demandas", "contato"];
      for (const id of sections) {
        const el = document.getElementById(id);
        if (el) {
          const top = el.offsetTop - 140;
          const height = el.offsetHeight;
          if (scrollY >= top && scrollY < top + height) {
            currentNav = id;
            break;
          }
        }
      }
    }

    navLinks.forEach((link) => {
      const target = link.dataset.nav;
      link.classList.toggle("is-active", target === currentNav);
    });
  }

  function onScroll() {
    const p = progress();
    targetFrame = p * LAST;
    updateStep(p);
    updateNavActiveState();
    if (!isTicking) {
      isTicking = true;
      requestAnimationFrame(tick);
    }
  }

  // Load a single frame asynchronously
  async function loadFrame(index) {
    if (frames[index]) return frames[index];
    if (loadingPromises.has(index)) return loadingPromises.get(index);

    const promise = (async () => {
      try {
        const res = await fetch(paths[index], { cache: "force-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        let source;
        if (typeof createImageBitmap === "function") {
          source = await createImageBitmap(blob);
        } else {
          source = await new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(blob);
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = reject;
            img.src = url;
          });
        }
        frames[index] = source;
        if (Math.abs(Math.round(currentFrame) - index) <= 1) {
          draw(Math.round(currentFrame));
        }
        return source;
      } catch (err) {
        console.warn(`Erro no frame ${index}`, err);
        return null;
      } finally {
        loadingPromises.delete(index);
      }
    })();

    loadingPromises.set(index, promise);
    return promise;
  }

  // Preload priority queue
  async function preloadAllFrames() {
    const queue = [];
    const queued = new Set();

    function add(idx) {
      if (idx >= 0 && idx < TOTAL && !queued.has(idx)) {
        queued.add(idx);
        queue.push(idx);
      }
    }

    for (let i = 0; i <= 12; i++) add(i);
    for (let i = 0; i < TOTAL; i += 6) add(i);
    add(LAST);
    for (let i = 0; i < TOTAL; i++) add(i);

    const concurrency = cfg().concurrency;
    let cursor = 0;

    async function worker() {
      while (cursor < queue.length) {
        const idx = queue[cursor++];
        if (!frames[idx]) {
          await loadFrame(idx);
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));
  }

  // Navigation click handling
  navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const navTarget = link.dataset.nav;
      const href = link.getAttribute("href");

      // If it's a link to another page (starts with / or .html) or external URL, let browser navigate normally
      if (!href || href.startsWith("http") || href.startsWith("/") || href.includes(".html")) {
        return;
      }

      event.preventDefault();

      if (navTarget === "inicio") {
        window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      } else if (navTarget === "transformacao") {
        if (experience) {
          const heroRange = experience.offsetHeight - window.innerHeight;
          const targetY = experience.offsetTop + heroRange * 0.65;
          window.scrollTo({ top: targetY, behavior: reduceMotion ? "auto" : "smooth" });
        }
      } else if (href.startsWith("#")) {
        const targetElement = document.querySelector(href);
        if (targetElement) {
          const offset = targetElement.offsetTop - 80;
          window.scrollTo({ top: offset, behavior: reduceMotion ? "auto" : "smooth" });
        }
      }
    });
  });

  // Mobile Drawer Toggle Logic
  const mobileMenuToggle = document.getElementById("mobileMenuToggle");
  const mobileNavDrawer = document.getElementById("mobileNavDrawer");
  const mobileDrawerBackdrop = document.getElementById("mobileDrawerBackdrop");
  const mobileDrawerClose = document.getElementById("mobileDrawerClose");
  const drawerLinks = document.querySelectorAll(".drawer-link");

  function openMobileDrawer() {
    if (!mobileNavDrawer || !mobileDrawerBackdrop) return;
    mobileNavDrawer.classList.add("is-open");
    mobileDrawerBackdrop.classList.add("is-open");
    mobileNavDrawer.setAttribute("aria-hidden", "false");
    mobileMenuToggle?.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
  }

  function closeMobileDrawer() {
    if (!mobileNavDrawer || !mobileDrawerBackdrop) return;
    mobileNavDrawer.classList.remove("is-open");
    mobileDrawerBackdrop.classList.remove("is-open");
    mobileNavDrawer.setAttribute("aria-hidden", "true");
    mobileMenuToggle?.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
  }

  mobileMenuToggle?.addEventListener("click", openMobileDrawer);
  mobileDrawerClose?.addEventListener("click", closeMobileDrawer);
  mobileDrawerBackdrop?.addEventListener("click", closeMobileDrawer);

  drawerLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href") || "";
      const navTarget = link.dataset.drawerNav;
      closeMobileDrawer();

      if (href.startsWith("#") || href.includes("index.html#")) {
        const hash = href.split("#")[1];
        if (hash) {
          e.preventDefault();
          if (hash === "step-1" || hash === "inicio") {
            window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
          } else {
            const targetEl = document.getElementById(hash);
            if (targetEl) {
              const offset = targetEl.offsetTop - 70;
              window.scrollTo({ top: offset, behavior: reduceMotion ? "auto" : "smooth" });
            }
          }
        }
      }
    });
  });

  // Event Listeners
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      applyLength();
      resizeCanvas();
      onScroll();
    }, 80);
  }, { passive: true });

  window.addEventListener("orientationchange", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      applyLength();
      resizeCanvas();
      onScroll();
    }, 150);
  });

  // BOOT
  async function boot() {
    injectOptimizations();
    document.querySelectorAll(".title-line, .title-line--accent em").forEach(splitText);
    applyLength();
    resizeCanvas();

    const p = progress();
    targetFrame = currentFrame = p * LAST;
    updateStep(p);
    updateNavActiveState();

    await loadFrame(Math.round(currentFrame) || 0);
    draw(Math.round(currentFrame) || 0);

    preloadAllFrames();
  }

  boot();
});
