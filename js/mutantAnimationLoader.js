const backgroundCache = new Map();
const screenUrlCache = new Map();
const screenLoadingCache = new Map();

let currentMutantCode = "";
let currentAnimationName = "stand";
let currentSkinName = "";
let availableSkins = [];
let currentBitmap = "";
let currentSpriteElement = null;
let mutantReady = false;
let mutantLoading = false;
let stateListeners = [];
let externalLoadingCount = 0;
let backgroundLoading = false;
let currentBackgroundValue = null;
let backgroundLoadController = null;
let cachedStandTree = null;
let cachedStandImage = null;
let cachedStandKey = null;

function isCampaignBackground(value) {
  const background = allBackgrounds.find(item => item.value === value);
  return background?.type === "bg_cmp";
}

function loadScreenImage(value) {
  if (!value) return Promise.resolve(null);
  if (isCampaignBackground(value)) return Promise.resolve(null);
  if (screenUrlCache.has(value)) return Promise.resolve(screenUrlCache.get(value));
  if (screenLoadingCache.has(value)) return screenLoadingCache.get(value);
  const url = `https://s-beta.kobojo.com/mutants/assets/pveeventcontent/screen_${value}.jpg`;
  const promise = loadImageWithRetry(url, 10000)
    .then(() => { screenUrlCache.set(value, url); return url; });
  screenLoadingCache.set(value, promise);
  promise.then(
    () => screenLoadingCache.delete(value),
    () => screenLoadingCache.delete(value)
  );
  return promise;
}

function getScreenUrlFor(value) {
  if (!value) return null;
  return screenUrlCache.get(value) || null;
}

function loadImageWithRetry(url, timeoutMs = 10000, maxAttempts = Infinity, signal) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    let warned = false;
    let settled = false;
    let activeImage = null;
    let activeTimer = null;
    let retryTimer = null;
    const cleanup = () => {
      clearTimeout(activeTimer);
      clearTimeout(retryTimer);
      if (signal) signal.removeEventListener("abort", handleAbort);
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const handleAbort = () => {
      if (activeImage) {
        activeImage.onload = null;
        activeImage.onerror = null;
        activeImage.src = "";
      }
      fail(new Error(`Image load aborted: ${url}`));
    };
    const tryLoad = () => {
      if (signal && signal.aborted) {
        handleAbort();
        return;
      }
      attempt++;
      const img = new Image();
      activeImage = img;
      img.crossOrigin = "anonymous";
      activeTimer = setTimeout(() => {
        img.onload = null;
        img.onerror = null;
        img.src = "";
        retryOrReject(new Error("timeout"));
      }, timeoutMs);
      img.onload = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(img);
      };
      img.onerror = () => {
        clearTimeout(activeTimer);
        activeTimer = null;
        retryOrReject(new Error("image load error"));
      };
      img.src = url;
    };
    const retryOrReject = error => {
      if (attempt < maxAttempts) {
        if (!warned) {
          console.warn(`No se pudo cargar ${url}; se reintentará.`, error);
          warned = true;
        }
        retryTimer = setTimeout(tryLoad, 1000);
      } else {
        fail(error);
      }
    };
    if (signal) signal.addEventListener("abort", handleAbort, { once: true });
    tryLoad();
  });
}

let backgroundRequestId = 0;
async function setBackgroundByValue(value) {
  const requestId = ++backgroundRequestId;
  if (backgroundLoadController) backgroundLoadController.abort();
  backgroundLoadController = null;
  if (!value) {
    currentBackgroundValue = null;
    window.sceneRenderer.setBackground(null);
    if (typeof window.applyEventBackground === "function") window.applyEventBackground();
    backgroundLoading = false;
    notifyStateChange();
    return;
  }
  const controller = new AbortController();
  backgroundLoadController = controller;
  backgroundLoading = true;
  notifyStateChange();
  try {
    const canvasPromise = backgroundCache.has(value)
      ? Promise.resolve(backgroundCache.get(value))
      : loadBackgroundImage(`https://s-beta.kobojo.com/mutants/assets/arenas/${value}.jpg`, controller.signal)
          .then(img => { backgroundCache.set(value, img); return img; });
    if (!isCampaignBackground(value)) loadScreenImage(value);
    const img = await canvasPromise;
    if (requestId !== backgroundRequestId) return;
    currentBackgroundValue = value;
    window.sceneRenderer.setBackground(img);
    if (typeof window.applyEventBackground === "function") window.applyEventBackground();
  } catch (e) {
    if (requestId === backgroundRequestId) {
      console.error("No se pudo cambiar el fondo; se conserva el fondo actual.", e);
    }
  } finally {
    if (requestId === backgroundRequestId) {
      backgroundLoading = false;
      backgroundLoadController = null;
      notifyStateChange();
    }
  }
}

function notifyStateChange() {
  const isLoading = mutantLoading || backgroundLoading || externalLoadingCount > 0;
  for (const cb of stateListeners) { try { cb(isLoading, mutantReady); } catch (_) {} }
}
function pushLoadingHold() { externalLoadingCount++; notifyStateChange(); }
function popLoadingHold() { if (externalLoadingCount > 0) externalLoadingCount--; notifyStateChange(); }
function subscribeState(cb) {
  if (typeof cb !== "function") return;
  stateListeners.push(cb);
  try { cb(mutantLoading || externalLoadingCount > 0, mutantReady); } catch (_) {}
}

async function fetchText(url, timeoutMs = 10000, label = "texto") {
  const fullUrl = url + (url.indexOf("?") === -1 ? "?nocache=" + Date.now() : "");
  return retryResource(async signal => {
    const res = await fetch(fullUrl, { signal });
    if (!res.ok) {
      throw createHttpError(res, url);
    }
    return res.text();
  }, timeoutMs, label);
}

function loadSpritesheetImage(bitmap, skin) {
  const base = bitmap.replace(/\.png$/i, "");
  const url = skin
    ? `/images/sprites/${base}_${skin}.png`
    : `/images/sprites/${base}.png`;
  return loadImageWithRetry(url);
}

function extractSkins(spriteEl) {
  const skins = [];
  for (const c of spriteEl.children) {
    if (c.tagName === "Skin") {
      const txt = (c.textContent || "").trim();
      if (txt) skins.push(txt);
    }
  }
  return skins;
}

function normalizeSkin(skin) {
  if (skin === undefined || skin === null) return currentSkinName;
  return String(skin).trim();
}

function normalizeAnimation(name) {
  if (name === undefined || name === null) return currentAnimationName || "stand";
  const s = String(name).trim();
  return s || (currentAnimationName || "stand");
}

function beginLoading(label = "") {
  mutantReady = false;
  mutantLoading = true;
  window.animationEngine.stopLoop();
  notifyStateChange();
}

function finishLoading(success, label = "") {
  mutantReady = !!success;
  mutantLoading = false;
  notifyStateChange();
}

async function loadMutantImage(mutantValue, animName, skin) {
  if (!mutantValue) return false;
  const effectiveAnim = normalizeAnimation(animName);
  const effectiveSkin = normalizeSkin(skin);
  beginLoading(`${mutantValue}/${effectiveAnim} skin=${effectiveSkin || "(none)"}`);
  const xmlPath = `/data/mutants/${mutantValue}/${effectiveAnim}.xml`;
  try {
    const txt = await fetchText(xmlPath, 10000, "mutant XML");
    const xml = new DOMParser().parseFromString(txt, "application/xml");
    const spriteEl = xml.querySelector("Sprite");
    if (!spriteEl) throw new Error("XML sin <Sprite>");
    const bitmap = spriteEl.getAttribute("bitmap") || "";
    currentMutantCode = mutantValue;
    currentAnimationName = effectiveAnim;
    currentSkinName = effectiveSkin;
    currentBitmap = bitmap;
    currentSpriteElement = spriteEl;
    availableSkins = extractSkins(spriteEl);
    const img = await loadSpritesheetImage(bitmap, effectiveSkin);
    if (!img) throw new Error("spritesheet no cargó");
    window.animationEngine.setSpritesheet(img);
    const tree = window.xmlParser.parseSpriteElement(spriteEl, 1);
    window.animationEngine.setTree(tree);
    window.animationEngine.pause();
    finishLoading(true, `${mutantValue}/${effectiveAnim}`);
    return true;
  } catch (e) {
    finishLoading(false, `${mutantValue}/${effectiveAnim}`);
    return false;
  }
}

async function setSkin(skin) {
  if (!currentSpriteElement) return false;
  const effectiveSkin = skin === undefined || skin === null ? "" : String(skin).trim();
  beginLoading(`skin=${effectiveSkin || "(none)"}`);
  try {
    const img = await loadSpritesheetImage(currentBitmap, effectiveSkin);
    if (!img) throw new Error("spritesheet no cargó");
    window.animationEngine.setSpritesheet(img);
    currentSkinName = effectiveSkin;
    cachedStandKey = null;
    cachedStandTree = null;
    cachedStandImage = null;
    window.animationEngine.startLoop();
    window.sceneRenderer.renderAll();
    finishLoading(true, `skin=${effectiveSkin}`);
    return true;
  } catch (e) {
    window.animationEngine.startLoop();
    window.sceneRenderer.renderAll();
    finishLoading(false, `skin=${effectiveSkin}`);
    return false;
  }
}

async function setAnimation(animName) {
  if (!currentMutantCode) return;
  await loadMutantImage(currentMutantCode, animName, currentSkinName);
}

async function reload() {
  if (!currentMutantCode) return;
  await loadMutantImage(currentMutantCode, currentAnimationName, currentSkinName);
}

async function loadStandTreeForMutant(mutantValue, skin) {
  if (!mutantValue) return null;
  const effectiveSkin = (skin === undefined || skin === null)
    ? (currentSkinName || "")
    : String(skin).trim();
  const key = `${mutantValue}|${effectiveSkin}`;
  if (cachedStandTree && cachedStandKey === key) {
    return { tree: cachedStandTree, image: cachedStandImage };
  }
  try {
    const xmlPath = `/data/mutants/${mutantValue}/stand.xml`;
    const txt = await fetchText(xmlPath, 10000, "stand XML");
    const xml = new DOMParser().parseFromString(txt, "application/xml");
    const spriteEl = xml.querySelector("Sprite");
    if (!spriteEl) return null;
    const bitmap = spriteEl.getAttribute("bitmap") || "";
    const img = await loadSpritesheetImage(bitmap, effectiveSkin);
    const tree = window.xmlParser.parseSpriteElement(spriteEl, 1);
    window.animationEngine.resetNodeState(tree, true);
    window.animationEngine.spriteUpdate(tree, 0);
    cachedStandTree = tree;
    cachedStandImage = img;
    cachedStandKey = key;
    return { tree, img };
  } catch (e) {
    return null;
  }
}

function getCurrentBackground() { return currentBackgroundValue; }
function loadBackgroundImage(url, signal) { return loadImageWithRetry(url, 10000, Infinity, signal); }
function isReady() { return mutantReady; }
function isLoading() { return mutantLoading || externalLoadingCount > 0; }
function getAvailableSkins() { return availableSkins.slice(); }
function getCurrentMutant() { return currentMutantCode; }
function getCurrentAnimation() { return currentAnimationName; }
function getCurrentSkin() { return currentSkinName; }

window.loadMutantImage = loadMutantImage;

window.mutantLoader = {
  loadMutantImage, setSkin, setAnimation, reload,
  getAvailableSkins, getCurrentMutant, getCurrentAnimation, getCurrentSkin,
  isReady, isLoading, subscribeState, pushLoadingHold, popLoadingHold,
  loadStandTreeForMutant,
  get mutantReady() { return mutantReady; },
  get mutantLoading() { return mutantLoading || externalLoadingCount > 0; },
  setBackgroundByValue, getCurrentBackground, getScreenUrlFor, loadScreenImage,
  isCampaignBackground,
};