const CHAR_TO_DIGIT = { e: "3", o: "0", a: "4", i: "1" };
const selectButtons = [mutantSelect, rivalSelect, skinSelect, animationSelect, rivalSkinSelect];

document.querySelectorAll("button:not([type])").forEach(btn => btn.setAttribute("type", "button"));

function parseAttackValue(rawValue) {
  const s = String(rawValue || "").trim();
  if (!s) return null;
  const parts = s.split(":");
  const damage = parseFloat(parts[0]) || 0;
  const isAOE = parts.slice(1).some(p => String(p).trim().toUpperCase() === "AOE");
  return { damage, isAOE };
}

async function loadGameDefinitions() {
  try {
    const url = `/data/gameconfig/gamedefinitions.xml?nocache=${Date.now()}`;
    const text = await retryResource(async signal => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw createHttpError(res, url);
      return res.text();
    }, 10000, url);
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("XML inválido");
    const map = {};
    const entities = xml.querySelectorAll('EntityDescriptor[category="specimen"]');
    for (const ent of entities) {
      const id = (ent.getAttribute("id") || "").trim().toLowerCase();
      if (!id) continue;
      const entry = {};
      for (const child of ent.children) {
        if (child.tagName !== "Tag") continue;
        const key = (child.getAttribute("key") || "").toLowerCase();
        if (!/^atk\d+p?$/.test(key)) continue;
        const parsed = parseAttackValue(child.getAttribute("value"));
        if (parsed) entry[key] = parsed;
      }
      if (Object.keys(entry).length > 0) map[id] = entry;
    }
    return map;
  } catch (e) {
    return {};
  }
}

function startBootWatchdog() {
  const attempts = parseInt(sessionStorage.getItem(BOOT_ATTEMPT_KEY) || "0", 10);
  if (attempts >= MAX_BOOT_ATTEMPTS) {
    return null;
  }
  return setTimeout(() => {
    sessionStorage.setItem(BOOT_ATTEMPT_KEY, String(attempts + 1));
    window.location.reload();
  }, BOOT_TIMEOUT_MS);
}

function cancelBootWatchdog(id) {
  if (id != null) clearTimeout(id);
}

function clearBootAttempts() {
  sessionStorage.removeItem(BOOT_ATTEMPT_KEY);
}

function getDiscordUserId(session) {
  if (!session || !session.user) return null;
  const meta = session.user.user_metadata || {};
  return meta.provider_id || meta.sub || session.user.id || null;
}

let accessUserId = null;

function normalizeAccessKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function loadAccessRules() {
  try {
    const url = `/data/access.json?nocache=${Date.now()}`;
    const data = await retryResource(async signal => {
      const res = await fetch(url, { signal });
      if (!res.ok) throw createHttpError(res, url);
      return res.json();
    }, 10000, url);
    const normalizeList = (arr) => new Set((arr || []).map(normalizeAccessKey).filter(Boolean));
    accessRules.exemptUserIds = new Set(
      (data.exemptUsers || data.exemptUserIds || [])
        .map(u => typeof u === "string" ? u : String(u.id))
        .filter(Boolean)
    );
    accessRules.blockedForEveryone = normalizeList(data.blockedForEveryone);
    accessRules.membersOnly = normalizeList(data.membersOnly);
    accessRules.blockedBackgroundsForEveryone = normalizeList(data.blockedBackgroundsForEveryone);
    accessRules.membersOnlyBackgrounds = normalizeList(data.membersOnlyBackgrounds);
    accessRules.newMutants = normalizeList(data.newMutants);
    accessRules.newSkins = normalizeList(data.newSkins);
    accessRules.newSkinEntries = Array.isArray(data.newSkins)
      ? data.newSkins.filter(skin => typeof skin === "string")
      : [];
    accessRules.newBackgrounds = normalizeList(data.newBackgrounds);
  } catch (e) {
    accessRules.exemptUserIds = new Set();
    accessRules.blockedForEveryone = new Set();
    accessRules.membersOnly = new Set();
    accessRules.blockedBackgroundsForEveryone = new Set();
    accessRules.membersOnlyBackgrounds = new Set();
    accessRules.newMutants = new Set();
    accessRules.newSkins = new Set();
    accessRules.newSkinEntries = [];
    accessRules.newBackgrounds = new Set();
  }
}

async function refreshAccessState(force = false) {
  const session = await window.discordIntegration.getSession();
  if (!session) {
    accessUserId = null;
    currentUserExempt = false;
    currentUserInGuild = false;
    return;
  }
  const userId = getDiscordUserId(session);
  if (String(userId) !== String(accessUserId)) {
    accessUserId = userId;
    currentUserExempt = false;
    currentUserInGuild = false;
  }
  currentUserExempt = false;
  if (userId && accessRules.exemptUserIds.has(String(userId))) {
    currentUserExempt = true;
    currentUserInGuild = true;
    return;
  }
  const membership = force
    ? await window.discordIntegration.checkGuildMembershipForced()
    : await window.discordIntegration.checkGuildMembership();
  if (membership !== null) currentUserInGuild = membership;
}

function canViewMutant(mutantValue) {
  if (!mutantValue) return true;
  const key = normalizeAccessKey(mutantValue);
  const isMembersOnly = accessRules.membersOnly.has(key);
  const isBlockedForEveryone = accessRules.blockedForEveryone.has(key);
  if (isMembersOnly) return currentUserInGuild || showHiddenMutants;
  if (isBlockedForEveryone) return currentUserExempt && showHiddenMutants;
  return true;
}

function canViewSkin(mutantValue, skinValue) {
  if (!mutantValue) return true;
  if (!skinValue) return canViewMutant(mutantValue);
  const composite = normalizeAccessKey(mutantValue + "_" + skinValue);
  const isMembersOnly = accessRules.membersOnly.has(composite);
  const isBlockedForEveryone = accessRules.blockedForEveryone.has(composite);
  if (isMembersOnly) return currentUserInGuild || showHiddenMutants;
  if (isBlockedForEveryone) return currentUserExempt && showHiddenMutants;
  return canViewMutant(mutantValue);
}

function hasVisibleNewSkin(mutantValue) {
  const prefix = `${mutantValue}_`.toLowerCase();
  return accessRules.newSkinEntries.some(skin => {
    const entry = skin.toLowerCase();
    if (!entry.startsWith(prefix) || entry.length === prefix.length) return false;
    const key = normalizeAccessKey(skin);
    const isRestricted = accessRules.blockedForEveryone.has(key) || accessRules.membersOnly.has(key);
    if (isRestricted && !showHiddenMutants) return false;
    return canViewSkin(mutantValue, skin.slice(prefix.length));
  });
}

function canViewBackground(bgValue) {
  if (!bgValue) return true;
  const key = normalizeAccessKey(bgValue);
  const isMembersOnly = accessRules.membersOnlyBackgrounds.has(key);
  const isBlockedForEveryone = accessRules.blockedBackgroundsForEveryone.has(key);
  if (isMembersOnly) {
    return currentUserInGuild || showHiddenBg;
  }
  if (isBlockedForEveryone) {
    return currentUserExempt && showHiddenBg;
  }
  return true;
}

function reRenderOpenLists() {
  if (listControllers.mutant && !listControllers.mutant.layer.classList.contains("hidden")) {
    renderCharacterList(mutantListLayerContext(), listControllers.mutant.search?.value || "");
  }
  if (listControllers.bg && !listControllers.bg.layer.classList.contains("hidden")) {
    renderBgList(listControllers.bg.search?.value || "");
  }
}

function showLoading() {
  loadingScreen.classList.remove("hidden");
  scaleContainerLayer.classList.remove("hidden");
  showStatic();
}

function hideLoading() {
  loadingScreen.classList.add("hidden");
  scaleContainerLayer.classList.add("hidden");
  hideStatic();
  const sc = document.getElementById("scale-container");
  if (sc) sc.classList.remove("hidden");
}

function normalizeKeepDigits(text) {
  return String(text || "")
    .replace(/\\n/g, " ").replace(/\\r/g, " ").replace(/\\t/g, " ")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;:!?¿¡'"`´]/g, "")
    .replace(/[-\u2010-\u2015_\s]+/g, "");
}

function buildSearchRegex(query) {
  const q = normalizeKeepDigits(query);
  let pattern = "";
  for (const ch of q) {
    if (CHAR_TO_DIGIT[ch]) {
      pattern += `(?:${ch}|${CHAR_TO_DIGIT[ch]})`;
    } else if (/[.*+?^${}()|[\]\\]/.test(ch)) {
      pattern += "\\" + ch;
    } else {
      pattern += ch;
    }
  }
  return pattern;
}

function filterByQuery(items, query, getName) {
  if (!query) return items;
  const q = normalizeKeepDigits(query);
  if (!q) return items;
  let re;
  try {
    re = new RegExp(buildSearchRegex(query));
  } catch (_) {
    return items.filter(it => normalizeKeepDigits(getName(it)).includes(q));
  }
  return items.filter(it => re.test(normalizeKeepDigits(getName(it))));
}

function checkRequirement(el) {
  const req = el.getAttribute("require");
  if (!req) return Promise.resolve(true);
  if (req === "login") return window.discordIntegration.requireLogin();
  if (req === "join") return window.discordIntegration.requireGuildMembership();
  return Promise.resolve(true);
}

function bindGated(el, handler) {
  if (!el) return;
  el.addEventListener("click", async (e) => {
    const ok = await checkRequirement(el);
    if (!ok) return;
    handler(e);
  });
}

async function loadMutants() {
  const parsed = await parseCustomTXT(`/data/characters.txt?nocache=${Date.now()}`, currentLang);
  allMutants = parsed.filter(p => p.type && p.type.startsWith("default"));
}

async function loadBackgrounds() {
  const parsed = await parseCustomTXT(`/data/options.txt?nocache=${Date.now()}`, currentLang);
  allBackgrounds = parsed.filter(p => p.type && p.type.startsWith("bg_"));
}

async function applyDefaultBackground() {
  if (!window.mutantLoader || typeof window.mutantLoader.setBackgroundByValue !== "function") return;
  let bg = allBackgrounds.find(b => b.value === DEFAULT_BG_VALUE);
  if (!bg) bg = allBackgrounds.find(b => b.name === "Detroit Rock City");
  if (bg && !canViewBackground(bg.value)) {
    bg = null;
  }
  if (bg) await window.mutantLoader.setBackgroundByValue(bg.value);
}

async function reloadMutantNames() {
  const parsed = await parseCustomTXT(`/data/characters.txt?nocache=${Date.now()}`, currentLang);
  allMutants = parsed.filter(p => p.type && p.type.startsWith("default"));
  if (selectedValues.mutant) {
    const found = allMutants.find(m => m.value === selectedValues.mutant);
    if (found) document.querySelector("#mutantSelect span").textContent = found.name;
    await loadMutantData(selectedValues.mutant);
    const skinVal = selectedSkin ? selectedSkin.value : null;
    const animVal = selectedAnimation ? selectedAnimation.value : null;
    const availableSkins = allSkins.filter(s => canViewSkin(selectedValues.mutant, s.value || ""));
    selectedSkin = availableSkins.find(s => (s.value || "") === (skinVal || "")) || availableSkins[0] || null;
    selectedAnimation = allAnimations.find(a => (a.value || "") === (animVal || "")) || allAnimations[0] || null;
    updateMutantThumbnail("mutant");
    updateSkinButton();
    updateAnimationButton();
  }
  if (selectedValues.rival) {
    const found = allMutants.find(m => m.value === selectedValues.rival);
    if (found) document.querySelector("#rivalSelect span").textContent = found.name;
    await loadRivalData(selectedValues.rival);
    const skinVal = selectedRivalSkin ? (selectedRivalSkin.value || "") : null;
    selectedRivalSkin = allRivalSkins.find(s => (s.value || "") === (skinVal || "")) || allRivalSkins[0] || null;
    updateMutantThumbnail("rival");
    updateRivalSkinButton();
  }
}

async function selectBg(bg) {
  if (!canViewBackground(bg.value)) {
    return;
  }
  closeBgList(); closeCharacterList(); closeItemList();
  clickToClose.classList.add("hidden"); scaleContainerLayer.classList.add("hidden"); hideStatic();
  if (window.mutantLoader && typeof window.mutantLoader.setBackgroundByValue === "function") {
    await window.mutantLoader.setBackgroundByValue(bg.value || null);
  }
}

async function loadOptions() {
  const parsed = await parseCustomTXT("/data/options.txt", currentLang);
  availableLangs = parsed.filter(l => l.type === "langs");
  availableSpeeds = parsed.filter(p => p.type === "speed");
  allBackgrounds = parsed.filter(p => p.type && p.type.startsWith("bg_"));
  window.currentLang = currentLang;
  const idx = availableSpeeds.findIndex(s => Math.abs(parseFloat(s.value) - 1) < 0.001);
  currentSpeedIndex = idx >= 0 ? idx : 0;
  renderLangMenu();
  updateFlagLang();
}

function initEventListeners() {
  setupMainMenu();
  setupInfoPopups();
  setupPlaybackControls();
  setupLoopControl();
  setupSpeedControl();
  setupSoundControl();
  setupTimeline();
  setupFullscreen();
  setupFullscreenKeyboard();
  setupCameraControls();
  setupBackgroundControls();
  setupScreenshot();
  setupDebugControls();
  window.discordIntegration.setupDiscordAuth();
  updateMidWatermark();
  window.discordIntegration.setupUserDropdown();
  btnLang.addEventListener("click", () => toggleLangMenu(true));
  clickToClose.addEventListener("click", () => toggleLangMenu(false));
  setupGeneFilters();
  setupGeneFilterEvents();
  mutantSelect.addEventListener("click", () => openCharacterList("mutant"));
  rivalSelect.addEventListener("click", () => openCharacterList("rival"));
  skinSelect.addEventListener("click", () => openItemList("skin"));
  animationSelect.addEventListener("click", () => openItemList("animation"));
  bindGated(rivalSkinSelect, () => openItemList("rivalSkin"));
  clickToClose.addEventListener("click", closeAnyList);
  setupMutantSearch();
  deathShaderReadyPromise = window.deathFxManager.init();
  window.discordIntegration.onAuthChanged(async () => {
    await refreshAccessState();
    reRenderOpenLists();
    if (typeof refreshDebugControls === "function") refreshDebugControls();
  });
  window.addEventListener("hashchange", () => { applyHashMutant(); });
  if (window.mutantLoader && typeof window.mutantLoader.subscribeState === "function") {
    window.mutantLoader.subscribeState((loading) => {
      if (loading) {
        canvasLoad.classList.remove("hidden");
        window.sceneRenderer.setCharacterVisible(false);
      } else {
        canvasLoad.classList.add("hidden");
        window.sceneRenderer.setCharacterVisible(true);
        window.animationEngine.startLoop();
      }
      setSelectButtonsBlocked(loading);
      setBgButtonsBlocked(loading);
      updatePlayButtonIcon();
      timelineLastFrame = -1;
      updateTimelineBar();
    });
  }
  let revalidating = false;
  const revalidateAccess = async () => {
    if (revalidating) return;
    revalidating = true;
    try {
      const session = await window.discordIntegration.getSession();
      if (!session) return;
      await refreshAccessState(true);
      reRenderOpenLists();
      if (typeof refreshDebugControls === "function") refreshDebugControls();
      window.sceneRenderer.renderAll();
    } finally {
      revalidating = false;
    }
  };
  window.addEventListener("focus", revalidateAccess);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) revalidateAccess();
  });
  window.setInterval(() => {
    if (!document.hidden) revalidateAccess();
  }, 15 * 60 * 1000);
}

function showStatic() { coverContainer.classList.remove("hidden"); clickBlocker.classList.remove("hidden"); }
function hideStatic() { coverContainer.classList.add("hidden"); clickBlocker.classList.add("hidden"); }

window.bindGated = bindGated;
window.applyEventBackground = applyEventBackground;
window.applyTickToAll = applyTickToAll;
window.stepTimeline = stepTimeline;
window.buildTransportSchedule = buildTransportSchedule;
window.buildSoundSchedule = buildSoundSchedule;
window.updateTransport = updateTransport;
window.playResumeSoundForTick = playResumeSoundForTick;
window.checkMomentTicks = checkMomentTicks;
window.checkSoundCrossings = checkSoundCrossings;
window.updateRivalHitProgress = updateRivalHitProgress;

document.addEventListener("DOMContentLoaded", async () => {
  const watchdogId = startBootWatchdog();
  playerButtons.forEach(btn => setPlayerButtonEnabled(btn, false));
  window.sceneRenderer.setCameraEnabled(false);
  showLoading();
  let bootOk = false;
  try {
    const [, , , defsMap] = await Promise.all([
      loadOptions(),
      loadMutants(),
      loadAccessRules(),
      loadGameDefinitions(),
    ]);
    mutantAttackData = defsMap;
    await refreshAccessState();
    await applyLanguage();
    await applyDefaultBackground();
    createListController("mutant");
    createListController("skin");
    createListController("bg");
    initEventListeners();
    await setDefaultRival("specimen_a_01");
    await applyHashMutant();
    requestIdleCallback(() => preloadThumbnails(), { timeout: 2000 });
    bootOk = true;
  } catch (e) {
    bootOk = false;
  } finally {
    cancelBootWatchdog(watchdogId);
    hideLoading();
    if (bootOk) clearBootAttempts();
  }
});