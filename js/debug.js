function loadColorTexture() {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = "/images/ui/circle_color.png";
  });
}

function tintTexture(baseImg, color) {
  const c = document.createElement("canvas");
  c.width = baseImg.naturalWidth;
  c.height = baseImg.naturalHeight;
  const cx = c.getContext("2d");
  cx.drawImage(baseImg, 0, 0);
  cx.globalCompositeOperation = "multiply";
  cx.fillStyle = color;
  cx.fillRect(0, 0, c.width, c.height);
  cx.globalCompositeOperation = "destination-in";
  cx.drawImage(baseImg, 0, 0);
  return c.toDataURL("image/png");
}

function updateToggleIcon(button, enabled) {
  const icon = button.querySelector(".activeIcon");
  if (!icon) return;
  const desired = enabled ? "/images/ui/icons/icon_on.png" : "/images/ui/icons/icon_off.png";
  if (icon.src.indexOf(desired) === -1) icon.src = desired;
}

function setBgButtonsBlocked(blocked) {
  for (const btn of bgButtonsForBlock) {
    if (!btn) continue;
    btn.classList.toggle("selectBlocked", blocked);
  }
}

function setupBackgroundControls() {
  const btnNone = document.getElementById("btnNone");
  bindGated(btnNone, async () => {
    if (window.mutantLoader && typeof window.mutantLoader.setBackgroundByValue === "function") {
      await window.mutantLoader.setBackgroundByValue(null);
    }
  });
  bgButtonsForBlock.length = 0;
  if (btnNone) bgButtonsForBlock.push(btnNone);
  for (const { id, type } of BG_BUTTONS) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    bgButtonsForBlock.push(btn);
    btn.addEventListener("click", () => openBgList(type));
  }
}

async function setupDebugControls() {
  const btnBounds = document.getElementById("btnBounds");
  const btnColor = document.getElementById("btnColor");
  const btnShowRival = document.getElementById("btnShowRival");
  const btnMultiple = document.getElementById("btnMultiple");
  const colorPicker = document.getElementById("colorPicker");
  const btnEffects = document.getElementById("btnEffects");
  const btnLights = document.getElementById("btnLights");
  const btnHiddenMutants = document.getElementById("btnHiddenMutants");
  const btnHiddenBg = document.getElementById("btnHiddenBg");
  const btnFrames = document.getElementById("btnFrames");
  const btnChangeBg = document.getElementById("btnChangeBg");
  if (!btnBounds || !btnColor || !colorPicker) return;
  const persisted = loadPersistedDebugState() || {};
  const canUseGuildToggles = currentUserInGuild;
  if (canUseGuildToggles) {
    if (typeof persisted.showRivalEnabled === "boolean") showRivalEnabled = persisted.showRivalEnabled;
    if (typeof persisted.multipleRivalsEnabled === "boolean") multipleRivalsEnabled = persisted.multipleRivalsEnabled;
    if (typeof persisted.showHiddenMutants === "boolean") showHiddenMutants = persisted.showHiddenMutants;
    if (typeof persisted.showHiddenBg === "boolean") showHiddenBg = persisted.showHiddenBg;
    if (typeof persisted.backgroundFromEventEnabled === "boolean") backgroundFromEventEnabled = persisted.backgroundFromEventEnabled;
  }
  const effectsEnabled = (canUseGuildToggles && typeof persisted.effectsEnabled === "boolean")
    ? persisted.effectsEnabled : true;
  const lightsEnabled = (canUseGuildToggles && typeof persisted.lightsEnabled === "boolean")
    ? persisted.lightsEnabled : true;
  window.fxManager.setEffectsEnabled(effectsEnabled);
  if (typeof window.fxManager.setLightsEnabled === "function") {
    window.fxManager.setLightsEnabled(lightsEnabled);
  }
  let boundsEnabled = typeof persisted.boundsEnabled === "boolean" ? persisted.boundsEnabled : false;
  let currentColor = typeof persisted.boundsColor === "string"
    ? persisted.boundsColor
    : (colorPicker.value || "#00ff00");
  let framesEnabled = typeof persisted.framesEnabled === "boolean" ? persisted.framesEnabled : false;
  window.animationEngine.setShowBounds(boundsEnabled);
  window.animationEngine.setBoundsColor(currentColor);
  window.sceneRenderer.setFrameCounterEnabled(framesEnabled);
  updateToggleIcon(btnBounds, boundsEnabled);
  if (btnShowRival) updateToggleIcon(btnShowRival, showRivalEnabled);
  if (btnMultiple) updateToggleIcon(btnMultiple, multipleRivalsEnabled);
  if (btnEffects) updateToggleIcon(btnEffects, effectsEnabled);
  if (btnLights) updateToggleIcon(btnLights, lightsEnabled);
  if (btnHiddenMutants) updateToggleIcon(btnHiddenMutants, showHiddenMutants);
  if (btnHiddenBg) updateToggleIcon(btnHiddenBg, showHiddenBg);
  if (btnChangeBg) updateToggleIcon(btnChangeBg, backgroundFromEventEnabled);
  if (btnFrames) updateToggleIcon(btnFrames, framesEnabled);
  const colorImg = btnColor.querySelector("img");
  const colorTexture = await loadColorTexture();
  if (colorTexture && colorImg) colorImg.src = tintTexture(colorTexture, currentColor);
  bindGated(btnBounds, () => {
    boundsEnabled = !boundsEnabled;
    window.animationEngine.setShowBounds(boundsEnabled);
    updateToggleIcon(btnBounds, boundsEnabled);
    savePersistedDebugState();
  });
  bindGated(btnShowRival, () => {
    showRivalEnabled = !showRivalEnabled;
    updateToggleIcon(btnShowRival, showRivalEnabled);
    const anim = selectedAnimation ? (selectedAnimation.value || "stand") : "stand";
    applyRivalVisibility(anim);
    savePersistedDebugState();
  });
  bindGated(btnMultiple, () => {
    multipleRivalsEnabled = !multipleRivalsEnabled;
    updateToggleIcon(btnMultiple, multipleRivalsEnabled);
    window.sceneRenderer.setMultipleRivalsEnabled(multipleRivalsEnabled);
    const anim = selectedAnimation ? (selectedAnimation.value || "stand") : "stand";
    applyRivalVisibility(anim);
    window.sceneRenderer.renderAll();
    savePersistedDebugState();
  });
  bindGated(btnEffects, () => {
    const next = !window.fxManager.isEffectsEnabled();
    window.fxManager.setEffectsEnabled(next);
    updateToggleIcon(btnEffects, next);
    window.sceneRenderer.renderAll();
    savePersistedDebugState();
  });
  bindGated(btnLights, () => {
    if (typeof window.fxManager.isLightsEnabled !== "function" ||
        typeof window.fxManager.setLightsEnabled !== "function") return;
    const next = !window.fxManager.isLightsEnabled();
    window.fxManager.setLightsEnabled(next);
    updateToggleIcon(btnLights, next);
    window.sceneRenderer.renderAll();
    savePersistedDebugState();
  });
  bindGated(btnHiddenMutants, () => {
    showHiddenMutants = !showHiddenMutants;
    updateToggleIcon(btnHiddenMutants, showHiddenMutants);
    reRenderOpenLists();
    if (typeof window.updateNewsAccess === "function") window.updateNewsAccess();
    savePersistedDebugState();
  });
  bindGated(btnHiddenBg, () => {
    showHiddenBg = !showHiddenBg;
    updateToggleIcon(btnHiddenBg, showHiddenBg);
    reRenderOpenLists();
    if (typeof window.updateNewsAccess === "function") window.updateNewsAccess();
    savePersistedDebugState();
  });
  bindGated(btnFrames, () => {
    framesEnabled = !framesEnabled;
    window.sceneRenderer.setFrameCounterEnabled(framesEnabled);
    updateToggleIcon(btnFrames, framesEnabled);
    savePersistedDebugState();
  });
  bindGated(btnColor, () => {
    colorPicker.value = currentColor;
    colorPicker.click();
  });
  bindGated(btnChangeBg, () => {
    backgroundFromEventEnabled = !backgroundFromEventEnabled;
    updateToggleIcon(btnChangeBg, backgroundFromEventEnabled);
    applyEventBackground();
    savePersistedDebugState();
  });
  colorPicker.addEventListener("input", () => {
    currentColor = colorPicker.value;
    if (colorTexture && colorImg) colorImg.src = tintTexture(colorTexture, currentColor);
    window.animationEngine.setBoundsColor(currentColor);
    savePersistedDebugState();
  });
  if (backgroundFromEventEnabled) applyEventBackground();
}

function refreshDebugControls() {
  const btnShowRival = document.getElementById("btnShowRival");
  const btnMultiple = document.getElementById("btnMultiple");
  const btnEffects = document.getElementById("btnEffects");
  const btnLights = document.getElementById("btnLights");
  const btnHiddenMutants = document.getElementById("btnHiddenMutants");
  const btnHiddenBg = document.getElementById("btnHiddenBg");
  const btnChangeBg = document.getElementById("btnChangeBg");
  if (!currentUserInGuild) {
    showRivalEnabled = true;
    multipleRivalsEnabled = true;
    showHiddenMutants = false;
    showHiddenBg = false;
    backgroundFromEventEnabled = false;
    window.fxManager.setEffectsEnabled(true);
    if (typeof window.fxManager.setLightsEnabled === "function") {
      window.fxManager.setLightsEnabled(true);
    }
    window.sceneRenderer.setMultipleRivalsEnabled(true);
    applyEventBackground();
    const anim = selectedAnimation ? (selectedAnimation.value || "stand") : "stand";
    applyRivalVisibility(anim);
    reRenderOpenLists();
    window.sceneRenderer.renderAll();
  }
  if (btnShowRival) updateToggleIcon(btnShowRival, showRivalEnabled);
  if (btnMultiple) updateToggleIcon(btnMultiple, multipleRivalsEnabled);
  if (btnEffects) updateToggleIcon(btnEffects, window.fxManager.isEffectsEnabled());
  if (btnLights && typeof window.fxManager.isLightsEnabled === "function") {
    updateToggleIcon(btnLights, window.fxManager.isLightsEnabled());
  }
  if (btnHiddenMutants) updateToggleIcon(btnHiddenMutants, showHiddenMutants);
  if (btnHiddenBg) updateToggleIcon(btnHiddenBg, showHiddenBg);
  if (btnChangeBg) updateToggleIcon(btnChangeBg, backgroundFromEventEnabled);
  if (typeof window.updateNewsAccess === "function") window.updateNewsAccess();
}