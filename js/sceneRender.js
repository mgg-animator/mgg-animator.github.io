const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ARENA_W = 1195;
const ARENA_H = 672;
const SLOT_C2 = { r: 2.7, g: 0.8, b: 11.0, a: 18.0 };
const SLOT_C3 = { r: 2.3, g: 312.0, b: 220.0, a: 55.0 };
const REFERENCE_HEIGHT = 672;

let rivalCount = 1;
let charConfigs = {
  stand: { x: 0, y: 0, scale: 1.10 },
  other: { x: -300, y: 0, scale: 0.60 }
};
let currentMode = "stand";
let rivalConfig = { x: 300, y: 0, flipX: true, flipY: false, scale: 0.60 };
let backgroundImage = null;
let bgX = 0, bgY = 0, bgW = 0, bgH = 0;
let cameraZoom = 1;
let cameraX = 0;
let cameraY = 0;
let cameraEnabled = false;
let midLayerImage = null;
let midLayerOpacity = 0.25;
let midLayerWidthRatio = 1.0;
let includeMidLayer = false;
let characterVisible = true;
let frameCounterEnabled = true;

function setMultipleRivalsEnabled(v) {
  multipleRivalsEnabled = !!v;
}

function isMultipleRivalsEnabled() {
  return multipleRivalsEnabled;
}

function computeFightSlotTransform(index, teamSize, teamSide) {
  const yIndex = index + (SLOT_C2.r - teamSize) * SLOT_C2.g;
  const spacing = SLOT_C2.b * teamSize + SLOT_C2.a;
  const parallaxMod = SLOT_C3.r - yIndex;
  const y = yIndex * (spacing + yIndex * spacing) + SLOT_C3.g;
  let x = SLOT_C3.b + parallaxMod * SLOT_C3.a;
  if (teamSide === 1) x = ARENA_W - x;
  const scale = (y * 0.5) / ARENA_H + 0.3;
  const zIndex = Math.trunc((y / ARENA_H) * 100);
  return { x, y, scale, zIndex };
}

function setRivalCount(n) {
  rivalCount = (n === 3) ? 3 : 1;
  if (window.fxManager && typeof window.fxManager.setTargetCount === "function") {
    window.fxManager.setTargetCount(rivalCount);
  }
  renderAll();
}

function getRivalCount() { return rivalCount; }

function setCharacterVisible(v) {
  characterVisible = !!v;
  renderAll();
}

function setFrameCounterEnabled(v) {
  frameCounterEnabled = !!v;
  renderAll();
}

function isFrameCounterEnabled() {
  return frameCounterEnabled;
}

let deathOffscreen = null;
function getDeathOffscreenCanvas(w, h) {
  if (!deathOffscreen) deathOffscreen = document.createElement("canvas");
  if (deathOffscreen.width !== w) deathOffscreen.width = w;
  if (deathOffscreen.height !== h) deathOffscreen.height = h;
  return deathOffscreen;
}

function ensureCameraInit() {
  const canvas = document.getElementById("mutantCanvas");
  if (!canvas) return false;
  if (bgW <= 0 || bgH <= 0) {
    bgX = 0; bgY = 0; bgW = canvas.width; bgH = canvas.height;
    cameraZoom = 1; cameraX = 0; cameraY = 0;
  }
  return true;
}

function computeBackgroundRect() {
  const canvas = document.getElementById("mutantCanvas");
  if (!canvas || !backgroundImage) return;
  const scale = Math.max(canvas.width / backgroundImage.width, canvas.height / backgroundImage.height);
  bgW = backgroundImage.width * scale;
  bgH = backgroundImage.height * scale;
  bgX = (canvas.width - bgW) / 2;
  bgY = (canvas.height - bgH) / 2;
}

function clampCamera() {
  const canvas = document.getElementById("mutantCanvas");
  if (!canvas || bgW <= 0 || bgH <= 0) return;
  const viewW = canvas.width / cameraZoom;
  const viewH = canvas.height / cameraZoom;
  if (viewW >= bgW) cameraX = bgX + (bgW - viewW) / 2;
  else cameraX = Math.max(bgX, Math.min(cameraX, bgX + bgW - viewW));
  if (viewH >= bgH) cameraY = bgY + (bgH - viewH) / 2;
  else cameraY = Math.max(bgY, Math.min(cameraY, bgY + bgH - viewH));
}

function resetCamera() {
  const canvas = document.getElementById("mutantCanvas");
  if (!canvas) return;
  if (!backgroundImage) {
    bgX = 0; bgY = 0; bgW = canvas.width; bgH = canvas.height;
  }
  cameraZoom = 1;
  cameraX = bgX + bgW / 2 - canvas.width / 2;
  cameraY = bgY + bgH / 2 - canvas.height / 2;
  clampCamera();
}

function setBackground(img) {
  backgroundImage = img || null;
  computeBackgroundRect();
  resetCamera();
  renderAll();
}

function setCameraEnabled(value) {
  cameraEnabled = !!value;
}

function panCameraBy(dxCanvas, dyCanvas) {
  if (!cameraEnabled) return;
  cameraX -= dxCanvas / cameraZoom;
  cameraY -= dyCanvas / cameraZoom;
  clampCamera();
}

function zoomCameraAt(canvasX, canvasY, factor) {
  if (!cameraEnabled) return;
  const oldZoom = cameraZoom;
  let newZoom = oldZoom * factor;
  newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
  if (Math.abs(newZoom - oldZoom) < 1e-6) return;
  const worldX = cameraX + canvasX / oldZoom;
  const worldY = cameraY + canvasY / oldZoom;
  cameraZoom = newZoom;
  cameraX = worldX - canvasX / newZoom;
  cameraY = worldY - canvasY / newZoom;
  clampCamera();
}

function getCamera() {
  return { zoom: cameraZoom, x: cameraX, y: cameraY };
}

function getScaleFromPositionY(gameY) {
  return (gameY * 0.5) / REFERENCE_HEIGHT + 0.3;
}

function getWorldY() {
  const canvas = document.getElementById("mutantCanvas");
  if (!canvas) return 0;
  return bgY + bgH / 2 - canvas.height / 2 + canvas.height / 1.3;
}

function getCharacterScale(mode) {
  const cfg = charConfigs[mode || currentMode] || charConfigs.stand;
  return cfg.scale;
}

function setCharConfig(mode, cfg) {
  if (!charConfigs[mode]) charConfigs[mode] = { x: 0, y: 0, scale: 0.80 };
  if (!cfg) return;
  if (cfg.x !== undefined) charConfigs[mode].x = Number(cfg.x) || 0;
  if (cfg.y !== undefined) charConfigs[mode].y = Number(cfg.y) || 0;
  if (cfg.scale !== undefined && Number(cfg.scale) > 0) charConfigs[mode].scale = Number(cfg.scale);
  renderAll();
}

function getCharConfig(mode) {
  return { ...charConfigs[mode || currentMode] };
}

function setCharMode(mode) {
  if (charConfigs[mode]) currentMode = mode;
  renderAll();
}

function getCharMode() {
  return currentMode;
}

function setRivalTransform(cfg) {
  if (!cfg) return;
  if (cfg.x !== undefined) rivalConfig.x = Number(cfg.x) || 0;
  if (cfg.y !== undefined) rivalConfig.y = Number(cfg.y) || 0;
  if (cfg.flipX !== undefined) rivalConfig.flipX = !!cfg.flipX;
  if (cfg.flipY !== undefined) rivalConfig.flipY = !!cfg.flipY;
  if (cfg.scale !== undefined && Number(cfg.scale) > 0) rivalConfig.scale = Number(cfg.scale);
  renderAll();
}

function getRivalTransform() {
  return { ...rivalConfig };
}

function setMidLayerImage(img, opacity, widthRatio) {
  midLayerImage = img || null;
  if (opacity !== undefined && Number.isFinite(opacity)) {
    midLayerOpacity = Math.max(0, Math.min(1, opacity));
  }
  if (widthRatio !== undefined && Number.isFinite(widthRatio)) {
    midLayerWidthRatio = Math.max(0, widthRatio);
  }
  renderAll();
}

function setIncludeMidLayer(value) {
  includeMidLayer = !!value;
}

function drawMidLayer(ctx) {
  if (!includeMidLayer || !midLayerImage) return;
  const canvas = document.getElementById("mutantCanvas");
  if (!canvas) return;
  const targetW = canvas.width * midLayerWidthRatio;
  const targetH = midLayerImage.height * (targetW / midLayerImage.width);
  const x = (canvas.width - targetW) / 2;
  const y = (canvas.height - targetH) / 2;
  ctx.save();
  ctx.globalAlpha = midLayerOpacity;
  ctx.drawImage(midLayerImage, x, y, targetW, targetH);
  ctx.restore();
}

function drawBackgroundTint(ctx, x, y, w, h) {
  const t = window.fxManager?.getObjectTransform?.("background");
  if (!t) return;
  const hasMul = Math.abs(t.rMul - 1) > 0.001 ||
                 Math.abs(t.gMul - 1) > 0.001 ||
                 Math.abs(t.bMul - 1) > 0.001;
  const hasAdd = t.rAdd > 0.001 || t.gAdd > 0.001 || t.bAdd > 0.001;
  if (hasMul) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = `rgb(${(t.rMul * 255) | 0},${(t.gMul * 255) | 0},${(t.bMul * 255) | 0})`;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
  if (hasAdd) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgb(${(t.rAdd * 255) | 0},${(t.gAdd * 255) | 0},${(t.bAdd * 255) | 0})`;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }
}

function renderCharacterWithEffects(ctx, tree, image, scale, flipX, anchorX, anchorY, colorTransform, shakeX, shakeY) {
  const engine = window.animationEngine;
  if (!tree || !image) return;
  const cMul = {
    r: colorTransform ? colorTransform.rMul : 1,
    g: colorTransform ? colorTransform.gMul : 1,
    b: colorTransform ? colorTransform.bMul : 1,
  };
  const cAdd = {
    r: colorTransform ? colorTransform.rAdd : 0,
    g: colorTransform ? colorTransform.gAdd : 0,
    b: colorTransform ? colorTransform.bAdd : 0,
  };
  const useDeath =
    engine.isDying() &&
    !flipX &&
    window.deathFxManager &&
    window.deathFxManager.isInitialized();
  if (useDeath) {
    const b = engine.getTreeBounds(tree);
    const pad = 8;
    const w = Math.ceil(b.maxX - b.minX) + pad * 2;
    const h = Math.ceil(b.maxY - b.minY) + pad * 2;
    if (w > 0 && h > 0 && w < 2048 && h < 2048) {
      const off = getDeathOffscreenCanvas(w, h);
      const octx = off.getContext("2d");
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, w, h);
      octx.save();
      octx.translate(-b.minX + pad, -b.minY + pad);
      engine.renderNode(octx, tree, true, cMul, cAdd, image);
      octx.restore();
      ctx.save();
      ctx.translate(anchorX + shakeX, anchorY + shakeY);
      const sx = flipX ? -1 : 1;
      ctx.scale(sx * scale, scale);
      ctx.translate(b.minX - pad, b.minY - pad);
      window.deathFxManager.applyToCanvas(
        ctx,
        off,
        engine.getDeathProgress(),
        engine.getDeathFireColor()
      );
      ctx.restore();
      return;
    }
  }
  ctx.save();
  ctx.translate(anchorX + shakeX, anchorY + shakeY);
  const sx = flipX ? -1 : 1;
  ctx.scale(sx * scale, scale);
  engine.renderNode(ctx, tree, true, cMul, cAdd, image);
  ctx.restore();
}

function drawAnchorMarker(ctx, x, y, color) {
  const r = 7;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color || "#00ff00";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  const d = r * 0.7;
  ctx.beginPath();
  ctx.moveTo(x - d, y - d);
  ctx.lineTo(x + d, y + d);
  ctx.moveTo(x + d, y - d);
  ctx.lineTo(x - d, y + d);
  ctx.stroke();
  ctx.restore();
}

function renderAll() {
  const canvas = document.getElementById("mutantCanvas");
  if (!canvas) return;
  const engine = window.animationEngine;
  if (!engine) return;
  ensureCameraInit();
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const animTree = engine.getRenderTree();
  const animImage = engine.getRenderImage();
  const rivalTree = engine.getRivalTree();
  if (!backgroundImage && !animTree && !rivalTree && !midLayerImage) return;
  ctx.save();
  ctx.translate(-cameraX * cameraZoom, -cameraY * cameraZoom);
  ctx.scale(cameraZoom, cameraZoom);
  const bgShake = window.fxManager?.getShakeOffset?.("background") || { x: 0, y: 0 };
  if (backgroundImage) {
    ctx.drawImage(backgroundImage, bgX + bgShake.x, bgY + bgShake.y, bgW, bgH);
    drawBackgroundTint(ctx, bgX + bgShake.x, bgY + bgShake.y, bgW, bgH);
  }
  ctx.save();
  ctx.translate(cameraX, cameraY);
  ctx.scale(1 / cameraZoom, 1 / cameraZoom);
  drawMidLayer(ctx);
  ctx.restore();
  const worldX = bgX + bgW / 2;
  const worldY = getWorldY();
  const arenaScale = bgW / ARENA_W;
  const useArenaPositioning = (currentMode === "other");
  const playerTransform = useArenaPositioning
    ? computeFightSlotTransform(1, 3, 0)
    : null;
  const attackerScale = useArenaPositioning
    ? playerTransform.scale * arenaScale
    : (charConfigs[currentMode] || charConfigs.stand).scale;
  const rivalScale = rivalConfig.scale;
  const selfShake = window.fxManager?.getShakeOffset?.("self") || { x: 0, y: 0 };
  const targShake = window.fxManager?.getShakeOffset?.("target") || { x: 0, y: 0 };
  const offsets = animTree ? engine.getTransportOffset() : { x: 0, y: 0 };
  const selfAnchorX = useArenaPositioning
    ? bgX + playerTransform.x * arenaScale + offsets.x
    : worldX + (charConfigs[currentMode] || charConfigs.stand).x + offsets.x;
  const selfAnchorY = useArenaPositioning
    ? bgY + playerTransform.y * arenaScale + offsets.y
    : worldY + (charConfigs[currentMode] || charConfigs.stand).y + offsets.y;
  const rivalAnchorX = worldX + rivalConfig.x;
  const rivalAnchorY = worldY + rivalConfig.y;
  const selfTransform = window.fxManager?.getObjectTransform?.("self") || null;
  const targetTransform = window.fxManager?.getObjectTransform?.("target") || null;
  if (characterVisible) {
    const fxScale = canvas.width / 1020;
    const bgBounds = { x: bgX, y: bgY, w: bgW, h: bgH };
    if (rivalCount === 3 && engine.isRivalVisible() && rivalTree) {
      const rivalImg = engine.getRivalImage();
      const playerZ = computeFightSlotTransform(0, 1, 0).zIndex;
      const rivalTransforms = [];
      for (let i = 0; i < 3; i++) {
        rivalTransforms.push(computeFightSlotTransform(i, 3, 1));
      }
      window.fxManager?.render?.(ctx, {
        self: null, target: null, background: bgBounds,
      });
      const items = [];
      for (let i = 0; i < 3; i++) {
        items.push({ z: rivalTransforms[i].zIndex, kind: "rival", index: i });
      }
      items.push({ z: playerZ, kind: "player" });
      items.sort((a, b) => a.z - b.z);
      for (const item of items) {
        if (item.kind === "rival") {
          const t = rivalTransforms[item.index];
          const rx = bgX + t.x * arenaScale;
          const ry = bgY + t.y * arenaScale;
          const rScale = t.scale * arenaScale;
          renderCharacterWithEffects(
            ctx, rivalTree, rivalImg, rScale,
            true, rx, ry,
            targetTransform, targShake.x, targShake.y
          );
          window.fxManager?.render?.(ctx, {
            self: null,
            target: {
              x: rx - 100 * fxScale,
              y: ry - 300 * fxScale,
              w: 200 * fxScale,
              h: 300 * fxScale,
              scale: rScale,
              flipX: true,
              targetIndex: item.index,
            },
            background: null,
          });
        } else {
          if (engine.isDying()) {
            const splatter = engine.getDeathSplatter();
            if (splatter) {
              ctx.save();
              ctx.translate(selfAnchorX, selfAnchorY);
              ctx.scale(attackerScale, attackerScale);
              engine.renderNode(
                ctx, splatter.tree, true,
                { r: 1, g: 1, b: 1 }, { r: 0, g: 0, b: 0 },
                splatter.image
              );
              ctx.restore();
            }
          }
          if (animTree) {
            renderCharacterWithEffects(
              ctx, animTree, animImage, attackerScale,
              false, selfAnchorX, selfAnchorY,
              selfTransform, selfShake.x, selfShake.y
            );
          }
          window.fxManager?.render?.(ctx, {
            self: {
              x: selfAnchorX - 100 * fxScale,
              y: selfAnchorY - 300 * fxScale,
              w: 200 * fxScale,
              h: 300 * fxScale,
              scale: attackerScale,
              flipX: false,
            },
            target: null,
            background: null,
          });
        }
      }
      if (engine.getShowBounds && engine.getShowBounds()) {
        const color = engine.getBoundsColor ? engine.getBoundsColor() : "#00ff00";
        drawAnchorMarker(ctx, selfAnchorX, selfAnchorY, color);
        for (let i = 0; i < 3; i++) {
          const t = rivalTransforms[i];
          drawAnchorMarker(ctx, bgX + t.x * arenaScale, bgY + t.y * arenaScale, color);
        }
      }
    } else {
      const rivalT = computeFightSlotTransform(1, 3, 1);
      const rx = bgX + rivalT.x * arenaScale;
      const ry = bgY + rivalT.y * arenaScale;
      const rs = rivalT.scale * arenaScale;
      if (engine.isRivalVisible() && rivalTree) {
        renderCharacterWithEffects(
          ctx, rivalTree, engine.getRivalImage(), rs,
          true, rx, ry,
          targetTransform, targShake.x, targShake.y
        );
      }
      if (engine.isDying()) {
        const splatter = engine.getDeathSplatter();
        if (splatter) {
          ctx.save();
          ctx.translate(selfAnchorX, selfAnchorY);
          ctx.scale(attackerScale, attackerScale);
          engine.renderNode(
            ctx, splatter.tree, true,
            { r: 1, g: 1, b: 1 }, { r: 0, g: 0, b: 0 },
            splatter.image
          );
          ctx.restore();
        }
      }
      if (animTree) {
        renderCharacterWithEffects(
          ctx, animTree, animImage, attackerScale,
          false, selfAnchorX, selfAnchorY,
          selfTransform, selfShake.x, selfShake.y
        );
      }
      window.fxManager?.render?.(ctx, {
        self: {
          x: selfAnchorX - 100 * fxScale,
          y: selfAnchorY - 300 * fxScale,
          w: 200 * fxScale,
          h: 300 * fxScale,
          scale: attackerScale,
          flipX: false,
        },
        target: {
          x: rx - 100 * fxScale,
          y: ry - 300 * fxScale,
          w: 200 * fxScale,
          h: 300 * fxScale,
          scale: rs,
          flipX: true,
        },
        background: bgBounds,
      });
      if (engine.getShowBounds && engine.getShowBounds()) {
        const color = engine.getBoundsColor ? engine.getBoundsColor() : "#00ff00";
        drawAnchorMarker(ctx, selfAnchorX, selfAnchorY, color);
        if (engine.isRivalVisible() && rivalTree) {
          drawAnchorMarker(ctx, rx, ry, color);
        }
      }
    }
  }
  ctx.restore();
  if (frameCounterEnabled) {
    const info = engine.getInfo();
    const total = Math.max(1, Math.ceil(info.tickDuration));
    const current = Math.min(total, Math.max(1, Math.floor(info.tickPosition) + 1));
    const text = `${current}/${total}`;
    const fontPx = Math.max(10, canvas.width * 0.024);
    const padding = Math.max(4, fontPx * 0.35);
    const boxH = fontPx * 1.5;
    const offsetCanvas = Math.max(6, canvas.width * 0.012);
    const rect = canvas.getBoundingClientRect();
    const cssScale = rect.width > 0 ? rect.width / canvas.width : 1;
    const visibleLeft = Math.max(0, -rect.left / cssScale);
    const visibleTop = Math.max(0, -rect.top / cssScale);
    const cbX = visibleLeft + offsetCanvas;
    const cbY = visibleTop + offsetCanvas;
    ctx.save();
    ctx.font = `bold ${fontPx}px Bahnschrift, Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const metrics = ctx.measureText(text);
    const boxW = metrics.width + padding * 2;
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(cbX, cbY, boxW, boxH);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, cbX + padding, cbY + padding - 1);
    ctx.restore();
  }
}

function clearCanvas() {
  const canvas = document.getElementById("mutantCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function resizeCanvasTo(width, height) {
  const canvas = document.getElementById("mutantCanvas");
  if (!canvas) return;
  const oldW = canvas.width || 1;
  const oldH = canvas.height || 1;
  if (width === oldW && height === oldH) return;
  const ratioW = width / oldW;
  const ratioH = height / oldH;
  const ratio = Math.min(ratioW, ratioH);
  canvas.width = width;
  canvas.height = height;
  bgX *= ratioW; bgY *= ratioH;
  bgW *= ratioW; bgH *= ratioH;
  cameraX *= ratioW; cameraY *= ratioH;
  for (const mode in charConfigs) {
    if (!charConfigs[mode]) continue;
    charConfigs[mode].x *= ratioW;
    charConfigs[mode].y *= ratioH;
    charConfigs[mode].scale *= ratio;
  }
  rivalConfig.x *= ratioW;
  rivalConfig.y *= ratioH;
  rivalConfig.scale *= ratio;
  const engine = window.animationEngine;
  if (engine) {
    const off = engine.getTransportOffset();
    engine.setTransportOffset(off.x * ratioW, off.y * ratioH);
  }
  clampCamera();
  renderAll();
}

window.sceneRenderer = {
  getArenaScale: () => bgW / ARENA_W,
  setBackground,
  resetCamera,
  panCamera: panCameraBy,
  zoomCamera: zoomCameraAt,
  getCamera,
  setCharConfig,
  getCharConfig,
  setCharMode,
  getCharMode,
  setRivalTransform,
  getRivalTransform,
  setMidLayerImage,
  setIncludeMidLayer,
  setCameraEnabled,
  setCharacterVisible,
  setFrameCounterEnabled,
  renderAll,
  clearCanvas,
  getScaleFromPositionY,
  getCharacterScale,
  getWorldY,
  resizeCanvasTo,
  computeFightSlotTransform,
  setRivalCount,
  getRivalCount,
  setMultipleRivalsEnabled,
  isMultipleRivalsEnabled,
  isFrameCounterEnabled,
};

window.animationEngine.setRenderCallback(renderAll);