function activateMenuButton(btn) {
  btn_menu.forEach(b => { b.classList.remove("active"); b.setAttribute("aria-pressed", "false"); });
  btn.classList.add("active"); btn.setAttribute("aria-pressed", "true");
  menuContent.forEach(sec => sec.classList.remove("active"));
  const target = document.getElementById(btn.dataset.target);
  if (target) target.classList.add("active");
}

function setupMainMenu() {
  btn_menu.forEach(btn => {
    if (btn === btnDebug) return;
    btn.addEventListener("click", () => activateMenuButton(btn));
  });
}

function setupInfoPopups() {
  logoManu.addEventListener("click", () => {
    scaleContainerLayer.classList.remove("hidden");
    infoLayer.classList.remove("hidden");
    showStatic();
  });
  infoClose.addEventListener("click", () => {
    scaleContainerLayer.classList.add("hidden");
    infoLayer.classList.add("hidden");
    hideStatic();
  });
}

function renderLangMenu() {
  langLayer.innerHTML = "";
  availableLangs.forEach(lang => {
    if (!getLanguagePageUrl(lang.value)) return;
    const item = document.createElement("div");
    item.className = "lang-item";
    item.innerHTML = `<img src="${lang.image}" class="lang-flag"><span class="lang-name">${lang.name}</span>`;
    item.addEventListener("click", () => selectLanguage(lang.value));
    langLayer.appendChild(item);
  });
}

function updateFlagLang() {
  const selected = availableLangs.find(l => l.value === currentLang);
  const flagImg = document.querySelector("#btnLang img.flag");
  if (selected && flagImg) flagImg.src = selected.image;
}

function toggleLangMenu(show) {
  if (show) {
    langLayer.classList.remove("hidden");
    clickToClose.classList.remove("hidden");
    scaleContainerLayer.classList.remove("hidden");
    showStatic();
  } else {
    langLayer.classList.add("hidden");
    clickToClose.classList.add("hidden");
    scaleContainerLayer.classList.add("hidden");
    hideStatic();
  }
}

function getLanguagePageUrl(langCode) {
  const code = String(langCode || "").trim().toLowerCase();
  const languagePage = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]'))
    .find(link => (link.getAttribute("hreflang") || "").trim().toLowerCase() === code);
  if (!languagePage) return null;

  const pageUrl = new URL(languagePage.href, window.location.href);
  const targetUrl = new URL(pageUrl.pathname, window.location.origin);
  targetUrl.search = window.location.search;
  targetUrl.hash = window.location.hash;
  return targetUrl;
}

function selectLanguage(langCode) {
  const targetUrl = getLanguagePageUrl(langCode);
  if (!targetUrl) {
    console.error(`No se encontró un destino hreflang para el idioma "${langCode}".`);
    toggleLangMenu(false);
    return;
  }

  toggleLangMenu(false);
  if (targetUrl.href !== window.location.href) {
    window.location.assign(targetUrl.href);
  }
}

async function applyLanguage() {
  const langsMap = await loadLangsFile();
  document.querySelectorAll("[data-lang]").forEach(el => {
    const key = el.getAttribute("data-lang");
    const langKey = `${key}-${currentLang}`;
    const value = langsMap[langKey] || langsMap[key];
    if (el.tagName === "INPUT" && el.hasAttribute("placeholder")) {
      el.setAttribute("placeholder", value || el.getAttribute("placeholder"));
    } else if (value) {
      el.textContent = value;
    }
  });
}

function swapBodyBackground(url) {
  const layers = [
    document.getElementById("bodyBgA"),
    document.getElementById("bodyBgB"),
  ];
  if (!layers[0] || !layers[1]) return;
  const nextIdx = 1 - currentBgLayer;
  const nextEl = layers[nextIdx];
  const curEl = layers[currentBgLayer];
  nextEl.style.backgroundImage = url;
  nextEl.style.opacity = "0.5";
  curEl.style.opacity = "0";
  currentBgLayer = nextIdx;
}

async function applyEventBackground() {
  const bgValue = window.mutantLoader && typeof window.mutantLoader.getCurrentBackground === "function"
    ? window.mutantLoader.getCurrentBackground()
    : null;
  const fallback = 'url("/images/ui/background.png")';
  if (!backgroundFromEventEnabled || !bgValue) {
    swapBodyBackground(fallback);
    return;
  }
  if (window.mutantLoader.isCampaignBackground(bgValue)) {
    swapBodyBackground(fallback);
    return;
  }
  const cached = window.mutantLoader && typeof window.mutantLoader.getScreenUrlFor === "function"
    ? window.mutantLoader.getScreenUrlFor(bgValue)
    : null;
  if (cached) {
    swapBodyBackground(`url("${cached}")`);
    return;
  }
  const screenUrl = await window.mutantLoader.loadScreenImage(bgValue);
  if (window.mutantLoader.getCurrentBackground() !== bgValue) return;
  if (!backgroundFromEventEnabled || !screenUrl) {
    swapBodyBackground(fallback);
    return;
  }
  swapBodyBackground(`url("${screenUrl}")`);
}

function setupGeneFilters() {
  document.querySelectorAll(".geneFilter").forEach(group => {
    group.querySelectorAll(".btnGene").forEach(btn => {
      btn.addEventListener("click", () => {
        group.querySelectorAll(".btnGene").forEach(b => {
          b.classList.remove("active");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
      });
    });
  });
}

function setupGeneFilterEvents() {
  document.querySelectorAll("#mutantFilter .btnGene").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#mutantFilter .btnGene").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilters.mutant = btn.dataset.value;
    });
  });
}

function disableAncestorTransforms() {
  if (savedAncestorStyles.length > 0) return;
  savedAncestorStyles = [];
  const wrapper = document.getElementById("canvasWrapper");
  if (!wrapper) return;
  let el = wrapper.parentElement;
  while (el && el !== document.documentElement) {
    const computed = getComputedStyle(el).transform;
    if (computed && computed !== "none") {
      savedAncestorStyles.push({
        el,
        transform: el.style.transform,
        left: el.style.left,
        top: el.style.top
      });
      el.style.setProperty("transform", "none", "important");
      el.style.setProperty("left", "0", "important");
      el.style.setProperty("top", "0", "important");
    }
    el = el.parentElement;
  }
}

function restoreAncestorTransforms() {
  for (const s of savedAncestorStyles) {
    s.el.style.removeProperty("transform");
    s.el.style.removeProperty("left");
    s.el.style.removeProperty("top");
    if (s.transform) s.el.style.transform = s.transform;
    if (s.left) s.el.style.left = s.left;
    if (s.top) s.el.style.top = s.top;
  }
  savedAncestorStyles = [];
}

function updateFullscreenLayout() {
  const canvas = document.getElementById("mutantCanvas");
  if (!canvas || !document.fullscreenElement) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  const bw = canvas.width, bh = canvas.height;
  const scale = Math.max(vw / bw, vh / bh);
  canvas.style.setProperty("width", Math.round(bw * scale) + "px", "important");
  canvas.style.setProperty("height", Math.round(bh * scale) + "px", "important");
  canvas.style.setProperty("position", "absolute", "important");
  canvas.style.setProperty("top", "50%", "important");
  canvas.style.setProperty("left", "50%", "important");
  canvas.style.setProperty("transform", "translate(-50%, -50%)", "important");
  canvas.style.setProperty("margin", "0", "important");
  canvas.style.setProperty("padding", "0", "important");
  canvas.style.setProperty("max-width", "none", "important");
  canvas.style.setProperty("max-height", "none", "important");
  canvas.style.setProperty("background-color", "#222", "important");
}

function clearFullscreenLayout() {
  const canvas = document.getElementById("mutantCanvas");
  if (!canvas) return;
  for (const prop of ["width","height","position","top","left","transform","margin","padding","max-width","max-height","background-color"]) {
    canvas.style.removeProperty(prop);
  }
}

function updateFullscreenIcon() {
  const img = btnFullscreen.querySelector("img");
  if (!img) return;
  const desired = document.fullscreenElement
    ? "/images/ui/icons/players/player_minimised.png"
    : "/images/ui/icons/players/player_fullscreen.png";
  if (img.src.indexOf(desired) === -1) img.src = desired;
}

function moveTimelineIntoFullscreen() {
  const wrapper = document.getElementById("canvasWrapper");
  const timeline = document.getElementById("playerTimeline");
  if (!wrapper || !timeline) return;
  if (timeline.parentElement === wrapper) return;
  timelinePlaceholder = document.createComment("playerTimeline-home");
  timeline.parentNode.insertBefore(timelinePlaceholder, timeline);
  wrapper.appendChild(timeline);
  timeline.classList.add("in-fullscreen");
  requestAnimationFrame(() => requestAnimationFrame(updateTimelineBar));
}

function moveTimelineBack() {
  const timeline = document.getElementById("playerTimeline");
  if (!timeline || !timelinePlaceholder) return;
  timeline.classList.remove("in-fullscreen");
  timelinePlaceholder.parentNode.insertBefore(timeline, timelinePlaceholder);
  timelinePlaceholder.parentNode.removeChild(timelinePlaceholder);
  timelinePlaceholder = null;
  requestAnimationFrame(() => { updateTimelineBar(); });
}

function setupFullscreen() {
  btnFullscreen.addEventListener("pointerdown", async (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (fullscreenLocked) return;
    fullscreenLocked = true;
    clearTimeout(fullscreenLockTimer);
    fullscreenLockTimer = setTimeout(() => { fullscreenLocked = false; }, 1500);
    const wrapper = document.getElementById("canvasWrapper");
    if (!wrapper) { fullscreenLocked = false; return; }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        disableAncestorTransforms();
        await wrapper.requestFullscreen();
      }
    } catch (_) {
      restoreAncestorTransforms();
      fullscreenLocked = false;
    }
  });
  btnFullscreen.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement) {
      requestAnimationFrame(() => {
        updateFullscreenLayout();
        moveTimelineIntoFullscreen();
        requestAnimationFrame(updateTimelineBar);
      });
    } else {
      moveTimelineBack();
      clearFullscreenLayout();
      restoreAncestorTransforms();
      if (typeof scaleSite === "function") scaleSite();
      if (typeof scaleCover === "function") scaleCover();
      requestAnimationFrame(() => {
        if (typeof scaleSite === "function") scaleSite();
        if (typeof scaleCover === "function") scaleCover();
        updateTimelineBar();
      });
    }
    updateFullscreenIcon();
    updateTimelineBar();
  });
  window.addEventListener("resize", () => {
    if (document.fullscreenElement) updateFullscreenLayout();
  });
  updateFullscreenIcon();
}

function setupFullscreenKeyboard() {
  window.addEventListener("keydown", (e) => {
    if (!document.fullscreenElement) return;
    const t = e.target;
    const tag = (t && t.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      if (!btnPlay.disabled) btnPlay.click();
      return;
    }
    if (e.code === "ArrowRight") {
      e.preventDefault();
      if (btnForward.disabled) return;
      if (!window.animationEngine.isPaused()) {
        window.animationEngine.pause();
        updatePlayButtonIcon();
      }
      stepTimeline(1);
      return;
    }
    if (e.code === "ArrowLeft") {
      e.preventDefault();
      if (btnBack.disabled) return;
      if (!window.animationEngine.isPaused()) {
        window.animationEngine.pause();
        updatePlayButtonIcon();
      }
      stepTimeline(-1);
      return;
    }
  });
}

function setupCameraControls() {
  const canvas = document.getElementById("mutantCanvas");
  if (!canvas || !window.animationEngine) return;
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.style.cursor = "default";
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (!selectedValues.mutant) return;
    cameraDragging = true;
    cameraDragLastX = e.clientX;
    cameraDragLastY = e.clientY;
    canvas.style.cursor = "grabbing";
    e.preventDefault();
  });
  window.addEventListener("pointermove", (e) => {
    if (!cameraDragging) return;
    const dx = e.clientX - cameraDragLastX;
    const dy = e.clientY - cameraDragLastY;
    cameraDragLastX = e.clientX;
    cameraDragLastY = e.clientY;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    window.sceneRenderer.panCamera(dx * scaleX, dy * scaleY);
  });
  window.addEventListener("pointerup", () => {
    if (!cameraDragging) return;
    cameraDragging = false;
    canvas.style.cursor = "grab";
  });
  window.addEventListener("pointercancel", () => {
    if (!cameraDragging) return;
    cameraDragging = false;
    canvas.style.cursor = "grab";
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (!selectedValues.mutant) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    window.sceneRenderer.zoomCamera(canvasX, canvasY, factor);
  }, { passive: false });
}

function loadMidWatermark() {
  if (midWatermarkLoaded) return Promise.resolve(midWatermarkImage);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { midWatermarkImage = img; midWatermarkLoaded = true; resolve(img); };
    img.onerror = () => { midWatermarkLoaded = true; resolve(null); };
    img.src = MID_WATERMARK_PATH;
  });
}

async function updateMidWatermark() {
  const img = await loadMidWatermark();
  if (!img) return;
  window.sceneRenderer.setMidLayerImage(img, MID_WATERMARK_OPACITY, MID_WATERMARK_WIDTH_RATIO);
}

function loadWatermark() {
  if (watermarkImage) return Promise.resolve(watermarkImage);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { watermarkImage = img; resolve(img); };
    img.onerror = () => resolve(null);
    img.src = "/images/ui/logo_manu.png";
  });
}

const SCREENSHOT_PREVIEW_WIDTH = 480;
const SCREENSHOT_HD_SCALE = 1;
const SCREENSHOT_UHD_SCALE = 3;

let screenshotAssets = null;
let screenshotLocked = false;
let screenshotWasPaused = false;

const SCREENSHOT_BLOCK_DEFS = [
  {
    container: "screenshotLeft",
    tier: "guest",
    preview: "hdWithMark",
    imgClass: "imgHd",
    langKey: "hd_text",
    btnId: "btnDownloadHdMark",
    btnLang: "Download",
    action: "download",
    assetKey: "hdWithMark",
    fileSuffix: "_HD",
  },
  {
    container: "screenshotLeft",
    tier: "user,member",
    preview: "hdNoMark",
    imgClass: "imgHd",
    langKey: "hd2_text",
    btnId: "btnDownloadHdNoMark",
    btnLang: "Download",
    action: "download",
    assetKey: "hdNoMark",
    fileSuffix: "_HD",
  },
  {
    container: "screenshotRight",
    tier: "guest",
    preview: "hdNoMark",
    imgClass: "imgHd",
    langKey: "hd2_text",
    btnId: "btnSignInSs",
    btnLang: "signin_dc",
    action: "exclusive",
  },
  {
    container: "screenshotRight",
    tier: "user",
    preview: "uhdNoMark",
    imgClass: "img4k",
    langKey: "4k_text",
    btnId: "btnJoinSs",
    btnLang: "join_dc",
    action: "join",
  },
  {
    container: "screenshotRight",
    tier: "member",
    preview: "uhdNoMark",
    imgClass: "img4k",
    langKey: "4k_text",
    btnId: "btnDownload4k",
    btnLang: "Download",
    action: "download",
    assetKey: "uhdNoMark",
    fileSuffix: "_4K",
  },
];

let screenshotBlocks = [];

function getScreenshotTier(session, inGuild) {
  if (!session) return "guest";
  if (!inGuild) return "user";
  return "member";
}

function downscaleCanvasTo(src, targetW) {
  const targetH = Math.round(targetW * src.height / src.width);
  const dst = document.createElement("canvas");
  dst.width = targetW;
  dst.height = targetH;
  const dctx = dst.getContext("2d");
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = "high";
  dctx.drawImage(src, 0, 0, targetW, targetH);
  return dst;
}

async function renderScreenshotAtScale(scale, includeMidLayer, includeCornerWatermark) {
  const canvas = document.getElementById("mutantCanvas");
  const origW = canvas.width;
  const origH = canvas.height;
  window.sceneRenderer.resizeCanvasTo(Math.round(origW * scale), Math.round(origH * scale));
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const octx = out.getContext("2d");
  octx.fillStyle = "#000";
  octx.fillRect(0, 0, out.width, out.height);
  if (includeMidLayer) {
    window.sceneRenderer.setIncludeMidLayer(true);
    window.sceneRenderer.renderAll();
  }
  octx.drawImage(canvas, 0, 0);
  if (includeMidLayer) {
    window.sceneRenderer.setIncludeMidLayer(false);
    window.sceneRenderer.renderAll();
  }
  if (includeCornerWatermark) {
    const logo = watermarkImage || await loadWatermark();
    if (logo && logo.complete && logo.naturalWidth > 0) {
      const targetW = Math.round(out.width * 0.2);
      const targetH = Math.round(logo.naturalHeight * (targetW / logo.naturalWidth));
      const margin = Math.round(out.width * 0.02);
      octx.drawImage(logo, out.width - targetW - margin, out.height - targetH - margin, targetW, targetH);
    }
  }
  window.sceneRenderer.resizeCanvasTo(origW, origH);
  return out;
}

async function generateScreenshotAssets() {
  const canvas = document.getElementById("mutantCanvas");
  const prevVis = canvas.style.visibility;
  canvas.style.visibility = "hidden";
  try {
    const session = await window.discordIntegration.getSession();
    const includeCorner = !currentUserExempt;
    const includeMidLayer = !session && !currentUserExempt;
    const hdMark = await renderScreenshotAtScale(SCREENSHOT_HD_SCALE, includeMidLayer, includeCorner);
    const hdNoMark = await renderScreenshotAtScale(SCREENSHOT_HD_SCALE, false, includeCorner);
    const uhdNoMark = await renderScreenshotAtScale(SCREENSHOT_UHD_SCALE, false, includeCorner);
    return {
      previews: {
        hdWithMark: downscaleCanvasTo(hdMark, SCREENSHOT_PREVIEW_WIDTH),
        hdNoMark: downscaleCanvasTo(hdNoMark, SCREENSHOT_PREVIEW_WIDTH),
        uhdNoMark: downscaleCanvasTo(uhdNoMark, SCREENSHOT_PREVIEW_WIDTH),
      },
      originals: {
        hdWithMark: hdMark,
        hdNoMark: hdNoMark,
        uhdNoMark: uhdNoMark,
      },
    };
  } finally {
    canvas.style.visibility = prevVis || "";
  }
}

function buildScreenshotBlocks() {
  const root = document.getElementById("screenshotLayer");
  if (!root) return;
  screenshotBlocks = [];
  for (const def of SCREENSHOT_BLOCK_DEFS) {
    const container = document.getElementById(def.container);
    if (!container) continue;
    const img = document.createElement("img");
    img.className = def.imgClass;
    img.setAttribute("data-ss-preview", def.preview);
    img.alt = "";
    const span = document.createElement("span");
    span.className = "screenshotText";
    span.setAttribute("data-lang", def.langKey);
    const btn = document.createElement("button");
    btn.className = "btn download";
    btn.id = def.btnId;
    btn.setAttribute("aria-pressed", "true");
    const btnSpan = document.createElement("span");
    btnSpan.className = "textBtn";
    btnSpan.setAttribute("data-lang", def.btnLang);
    btn.appendChild(btnSpan);
    container.appendChild(img);
    container.appendChild(span);
    container.appendChild(btn);
    const block = { def, img, span, btn };
    screenshotBlocks.push(block);
  }
  applyLanguage();
}

function populateScreenshotPreviews(previews) {
  for (const block of screenshotBlocks) {
    const canvas = previews[block.def.preview];
    if (!canvas) { block.img.removeAttribute("src"); continue; }
    block.img.src = canvas.toDataURL("image/jpeg", 0.7);
  }
}

function applyScreenshotTier(tier) {
  for (const block of screenshotBlocks) {
    const tiers = block.def.tier.split(",").map(s => s.trim());
    const show = tiers.includes(tier);
    const display = show ? "" : "none";
    block.img.style.display = display;
    block.span.style.display = display;
    block.btn.style.display = display;
  }
}

async function downloadScreenshotCanvas(canvas, baseName, suffix, ext) {
  const filename = getVersionedFilename(baseName + suffix, ext);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", SCREENSHOT_JPEG_QUALITY));
  if (!blob) return;
  downloadBlob(blob, filename);
}

function screenshotBaseName() {
  const found = allMutants.find(m => m.value === selectedValues.mutant);
  let base = (found && found.name) ? found.name : selectedValues.mutant;
  base = base.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
  return base || "screenshot";
}

function setupScreenshot() {
  const canvas = document.getElementById("mutantCanvas");
  const layer = document.getElementById("screenshotLayer");
  const closeBtn = document.getElementById("screenshotClose");
  if (!btnScreenshot || !canvas || !layer) return;
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  loadWatermark();
  loadMidWatermark();
  buildScreenshotBlocks();
  for (const block of screenshotBlocks) {
    block.btn.addEventListener("click", () => {
      const action = block.def.action;
      if (action === "join") {
        window.discordIntegration.openDiscordInvite();
        return;
      }
      if (action === "exclusive") {
        window.discordIntegration.signInWithDiscord();
        return;
      }
      if (action === "download") {
        if (!screenshotAssets) return;
        const asset = screenshotAssets.originals[block.def.assetKey];
        if (!asset) return;
        downloadScreenshotCanvas(asset, screenshotBaseName(), block.def.fileSuffix, ".jpg");
      }
    });
  }
  async function openModal() {
    if (screenshotLocked || !selectedValues.mutant) return;
    screenshotLocked = true;
    btnScreenshot.disabled = true;
    screenshotWasPaused = window.animationEngine.isPaused();
    window.animationEngine.pause();
    if (!screenshotWasPaused) await window.soundManager.pauseAllSounds();
    scaleContainerLayer.classList.remove("hidden");
    layer.classList.remove("hidden");
    showStatic();
    try {
      const session = await window.discordIntegration.getSession();
      await refreshAccessState();
      const tier = getScreenshotTier(session, currentUserInGuild);
      applyScreenshotTier(tier);
      screenshotAssets = await generateScreenshotAssets();
      populateScreenshotPreviews(screenshotAssets.previews);
    } catch (e) {
      console.error("screenshot generation failed", e);
    } finally {
      screenshotLocked = false;
      btnScreenshot.disabled = false;
    }
  }
  async function closeModal() {
    if (layer.classList.contains("hidden")) return;
    layer.classList.add("hidden");
    scaleContainerLayer.classList.add("hidden");
    hideStatic();
    screenshotAssets = null;
    if (!screenshotWasPaused) {
      await window.soundManager.resumeAllSounds();
      window.animationEngine.play();
    }
  }
  btnScreenshot.addEventListener("click", openModal);
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function getVersionedFilename(baseName, ext) {
  const key = `screenshotCount_${baseName}${ext}`;
  let count = parseInt(localStorage.getItem(key) || "0", 10);
  if (!Number.isFinite(count) || count < 0) count = 0;
  count++;
  try { localStorage.setItem(key, String(count)); } catch (_) {}
  if (count === 1) return `${baseName}${ext}`;
  return `${baseName} (${count - 1})${ext}`;
}