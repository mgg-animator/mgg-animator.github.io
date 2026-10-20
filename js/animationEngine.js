const UNIVERSAL_FPS = 30;
const SIMULATION_FPS = 60;
const FRAME_TIME_MS = 1000 / SIMULATION_FPS;

let loadedImage = null;
let rivalImage = null;
let animationTree = null;
let rivalTree = null;
let animationTime = 0;
let lastTimeMs = 0;
let accumulatorMs = 0;
let loopRunning = false;
let loopId = null;
let paused = false;
let currentSpeedFactor = 1;
let attackSpeedMultiplier = 1;
let stopAtEnd = false;
let autoRestart = false;
let rivalVisible = false;
let transportOffsetX = 0;
let transportOffsetY = 0;
let renderCallback = null;
let precomputedSnapshots = null;
let precomputedTotalTicks = 0;
let postTree = null;
let postImage = null;
let postStartTick = -1;
let tailEndTick = -1;
let deathState = {
  active: false,
  progress: 0,
  elapsed: 0,
  duration: 1.2,
  fireColor: [1, 1, 1, 1]
};
let deathSplatterTree = null;
let deathSplatterImage = null;
let backupTimer = null;

function startDeath(specimenCode) {
  deathState.active = true;
  deathState.progress = 0;
  deathState.elapsed = 0;
  deathState.specimenCode = specimenCode;
  deathState.fireColor = window.deathFxManager.getGeneColor(specimenCode);
  triggerRender();
}

function stopDeath() {
  deathState.active = false;
  deathState.progress = 0;
  deathState.elapsed = 0;
  deathSplatterTree = null;
  deathSplatterImage = null;
  triggerRender();
}

function isDying() { return deathState.active; }

function getDeathProgress() { return deathState.progress; }

function getDeathFireColor() { return deathState.fireColor; }

function setDeathSplatter(tree, image) {
  deathSplatterTree = tree || null;
  deathSplatterImage = image || null;
  if (deathSplatterTree) {
    resetNodeState(deathSplatterTree, true);
    forceLoopDisabled(deathSplatterTree);
    spriteUpdate(deathSplatterTree, 0);
  }
}

function getDeathSplatter() {
  if (!deathSplatterTree || !deathSplatterImage) return null;
  return { tree: deathSplatterTree, image: deathSplatterImage };
}

function startBackupLoop() {
  if (backupTimer !== null) return;
  backupTimer = setInterval(() => {
    if (!loopRunning || !document.hidden) return;
    const now = performance.now();
    const deltaMs = Math.min(1000, now - lastTimeMs);
    lastTimeMs = now;
    if (!paused) {
      accumulatorMs += deltaMs;
      while (accumulatorMs >= FRAME_TIME_MS) {
        accumulatorMs -= FRAME_TIME_MS;
        updateTick(1 / SIMULATION_FPS);
      }
    } else {
      accumulatorMs = 0;
    }
  }, 1000);
}

function stopBackupLoop() {
  if (backupTimer !== null) { clearInterval(backupTimer); backupTimer = null; }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) startBackupLoop();
  else { stopBackupLoop(); lastTimeMs = performance.now(); accumulatorMs = 0; }
});

function setRenderCallback(cb) { renderCallback = typeof cb === "function" ? cb : null; }

function triggerRender() { if (renderCallback) renderCallback(); }

function setAutoRestart(v) { autoRestart = !!v; }

function getAutoRestart() { return autoRestart; }

function setStopAtEnd(v) { stopAtEnd = !!v; }

function getStopAtEnd() { return stopAtEnd; }

function isAtEnd() {
  if (deathState.active) return deathState.progress >= 1;
  if (!animationTree) return false;
  const limit = tailEndTick > 0 ? tailEndTick : (precomputedSnapshots ? precomputedTotalTicks : animationTree.totalFrames);
  return animationTime >= limit - 1;
}

function play() { paused = false; lastTimeMs = performance.now(); accumulatorMs = 0; }

function pause() { paused = true; }

function togglePause() { if (paused) play(); else pause(); }

function isPaused() { return paused; }

function setSpeed(s) {
  const n = Number(s);
  currentSpeedFactor = Number.isFinite(n) && n >= 0 ? n : 1;
}

function setAttackSpeedMultiplier(m) {
  const n = Number(m);
  attackSpeedMultiplier = Number.isFinite(n) && n > 0 ? n : 1;
}

function getAttackSpeedMultiplier() { return attackSpeedMultiplier; }

function updateAttackTailAssets(tree, image) {
  if (tailEndTick <= 0) return;
  postTree = tree || null;
  postImage = image || null;
  if (postTree) {
    resetNodeState(postTree, true);
    spriteUpdate(postTree, 0);
  }
}

function setAttackTail(endTick, tree, img, startTick) {
  tailEndTick = endTick > 0 ? endTick : -1;
  postTree = tree || null;
  postImage = img || null;
  postStartTick = startTick >= 0 ? startTick : -1;
  if (postTree) {
    resetNodeState(postTree, true);
    spriteUpdate(postTree, 0);
  }
}

function clearAttackTail() {
  tailEndTick = -1;
  postTree = null;
  postImage = null;
  postStartTick = -1;
}

function getRenderTree() {
  if (postTree && postStartTick >= 0 && animationTime >= postStartTick) return postTree;
  return animationTree;
}

function getRenderImage() {
  if (postImage && postStartTick >= 0 && animationTime >= postStartTick) return postImage;
  return loadedImage;
}

function getTailEndTick() { return tailEndTick; }

function setFrame(node, newFrame) {
  if (newFrame === node.currentFrame && node.currentFrame !== -1) return false;
  node.currentFrame = newFrame;
  node.frameTicksElapsed = 0;
  return true;
}

function forceFrame(node, frame) {
  setFrame(node, frame);
  node.frameCounter = 0;
  node.frameAccumulator = 0;
  node.delayCounter = 0;
  node.frameTicksElapsed = 0;
}

function simulateSpriteTicks(node, ticks) {
  if (!node || node.type !== "Sprite") return;
  const total = node.totalFrames;
  if (total <= 0 || ticks === 0) return;
  const framerate = node.framerate;
  if (framerate <= 0) return;
  const sign = ticks < 0 ? -1 : 1;
  let remaining = Math.abs(ticks);
  let fc = node.frameCounter;
  let cf = node.currentFrame < 0 ? 0 : node.currentFrame;
  while (remaining > 0) {
    if (sign > 0) {
      const toNext = framerate - fc;
      if (remaining < toNext) { fc += remaining; remaining = 0; }
      else {
        remaining -= toNext;
        fc = 0;
        cf++;
        if (cf >= total) {
          if (node.loopEnabled) cf = node.loopFrame;
          else { cf = total - 1; remaining = 0; }
        }
      }
    } else {
      if (fc === 0) {
        cf--;
        if (cf < 0) {
          if (node.loopEnabled) cf = total - 1;
          else { cf = 0; remaining = 0; continue; }
        }
        fc = framerate - 1;
        remaining--;
      } else {
        const canGoBack = Math.min(remaining, fc);
        fc -= canGoBack;
        remaining -= canGoBack;
      }
    }
  }
  node.currentFrame = cf;
  node.frameCounter = fc;
  node.frameAccumulator = 0;
  node.delayCounter = 0;
  node.hasLoopedThisFrame = false;
  node.parentFramePos = Math.min(Math.max(0, cf), total - 0.001);
  node.frameTicksElapsed = 0;
}

function stepTree(node, ticks) {
  if (!node) return;
  if (node.type === "Sprite") {
    simulateSpriteTicks(node, ticks);
    for (const child of node.children) stepTree(child, ticks);
  } else if (node.type === "Composite") {
    if (node.innerSprite) stepTree(node.innerSprite, ticks);
  }
}

function refreshComposites(node) {
  if (!node) return;
  if (node.type === "Sprite") {
    for (const child of node.children) {
      if (child.type === "Composite") compositeUpdate(child, node.parentFramePos, 0);
      else if (child.type === "Sprite") refreshComposites(child);
    }
  } else if (node.type === "Composite") {
    if (node.innerSprite) refreshComposites(node.innerSprite);
  }
}

function updateChildren(node, dtSeconds) {
  for (const child of node.children) {
    if (child.type === "Composite") compositeUpdate(child, node.parentFramePos, dtSeconds);
    else if (child.type === "Sprite") spriteUpdate(child, dtSeconds);
  }
}

function spriteUpdate(node, dtSeconds) {
  if (!node) return;
  node.frameAccumulator += dtSeconds * UNIVERSAL_FPS;
  let fullSteps = Math.floor(node.frameAccumulator);
  node.frameAccumulator -= fullSteps;
  node.hasLoopedThisFrame = false;
  if (node.currentFrame === -1) setFrame(node, 0);
  while (fullSteps > 0) {
    fullSteps--;
    node.frameTicksElapsed = (node.frameTicksElapsed || 0) + 1;
    if (node.delayCounter < 1) {
      if (node.framerate !== 0) node.frameCounter = (node.frameCounter + 1) % node.framerate;
      else node.frameCounter = node.frameCounter + 1;
      if (node.frameCounter === 0) {
        let nextFrame = node.currentFrame + 1;
        if (nextFrame >= node.totalFrames) {
          const inTail = tailEndTick > 0 && animationTime < tailEndTick;
          if (autoRestart && node === animationTree && !inTail) {
            resetNodeState(animationTree, true);
            if (rivalTree) resetNodeState(rivalTree, true);
            animationTime = 0;
            accumulatorMs = 0;
            transportOffsetX = 0;
            transportOffsetY = 0;
            spriteUpdate(animationTree, 0);
            if (rivalTree) spriteUpdate(rivalTree, 0);
            node.hasLoopedThisFrame = true;
            return;
          }
          if (stopAtEnd && node === animationTree && !inTail) {
            resetNodeState(animationTree, true);
            if (rivalTree) resetNodeState(rivalTree, true);
            animationTime = 0;
            accumulatorMs = 0;
            transportOffsetX = 0;
            transportOffsetY = 0;
            spriteUpdate(animationTree, 0);
            if (rivalTree) spriteUpdate(rivalTree, 0);
            paused = true;
            break;
          }
          if (inTail && node === animationTree) return;
          node.hasLoopedThisFrame = true;
          if (node.loopEnabled) nextFrame = node.loopFrame;
          else { nextFrame = node.totalFrames - 1; node.frameAccumulator = 0; }
        }
        setFrame(node, nextFrame);
        if (node.loopEnabled) {
          if (node.currentFrame === node.loopFrame) {
            if (node.rndDelay < 1) node.delayCounter = 0;
            else node.delayCounter = node.minDelay + Math.floor(Math.random() * node.rndDelay);
          }
          const fd = node.frames[node.currentFrame];
          if (fd && fd.delay > 0) node.delayCounter += fd.delay;
        }
      }
    } else {
      node.delayCounter--;
    }
  }
  const currentSpeed = currentSpeedFactor * attackSpeedMultiplier;
  if (currentSpeed <= 0 || node.delayCounter >= 1) node.parentFramePos = node.currentFrame;
  else node.parentFramePos = node.currentFrame + node.frameAccumulator;
  if (node.parentFramePos > node.totalFrames - 0.001) node.parentFramePos = node.totalFrames - 0.001;
  updateChildren(node, dtSeconds);
}

function compositeUpdate(node, parentFramePos, dtSeconds) {
  if (!node) return;
  const keys = node.keys;
  const oldDrawThisFrame = node.drawThisFrame !== false;
  let newDrawThisFrame = true;
  if (keys.length === 0) {
    node.x = 0; node.y = 0; node.angle = 0;
    node.scaleX = 1; node.scaleY = 1;
    node.colorMul.r = 1; node.colorMul.g = 1; node.colorMul.b = 1;
    node.colorAdd.r = 0; node.colorAdd.g = 0; node.colorAdd.b = 0;
    node.alpha = 1; node.visible = true;
  } else if (keys.length === 1) {
    const k = keys[0];
    if (parentFramePos < k.frame) {
      node.visible = false;
      node.alpha = 0;
      newDrawThisFrame = false;
    } else {
      node.x = k.x; node.y = k.y; node.angle = k.angle;
      node.scaleX = k.scaleX; node.scaleY = k.scaleY;
      node.colorMul.r = k.rMul; node.colorMul.g = k.gMul; node.colorMul.b = k.bMul;
      node.colorAdd.r = k.rAdd; node.colorAdd.g = k.gAdd; node.colorAdd.b = k.bAdd;
      node.alpha = k.alpha; node.visible = k.visible;
    }
  } else {
    if (parentFramePos < keys[0].frame) {
      node.visible = false;
      node.alpha = 0;
      node.prevKey = null;
      node.nextKey = keys[0];
      newDrawThisFrame = false;
    } else {
      let low = 0;
      let high = keys.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (keys[mid].frame < parentFramePos) low = mid + 1;
        else high = mid;
      }
      const next = low < keys.length ? keys[low] : node.loopKey;
      let prev = keys[0];
      if (low < keys.length && keys[low].frame === parentFramePos) {
        prev = keys[low];
      } else if (low > 0) {
        const prevFrame = keys[low - 1].frame;
        let first = 0;
        let last = low;
        while (first < last) {
          const mid = (first + last) >>> 1;
          if (keys[mid].frame < prevFrame) first = mid + 1;
          else last = mid;
        }
        prev = keys[first];
      }
      const span = next.frame - prev.frame;
      const t = span > 0 ? Math.min((parentFramePos - prev.frame) / span, 1) : 0;
      node.x = prev.x + (next.x - prev.x) * t;
      node.y = prev.y + (next.y - prev.y) * t;
      node.angle = prev.angle + (next.angle - prev.angle) * t;
      node.scaleX = prev.scaleX + (next.scaleX - prev.scaleX) * t;
      node.scaleY = prev.scaleY + (next.scaleY - prev.scaleY) * t;
      if (node.hasColorChange) {
        node.colorMul.r = prev.rMul + (next.rMul - prev.rMul) * t;
        node.colorMul.g = prev.gMul + (next.gMul - prev.gMul) * t;
        node.colorMul.b = prev.bMul + (next.bMul - prev.bMul) * t;
        node.colorAdd.r = prev.rAdd + (next.rAdd - prev.rAdd) * t;
        node.colorAdd.g = prev.gAdd + (next.gAdd - prev.gAdd) * t;
        node.colorAdd.b = prev.bAdd + (next.bAdd - prev.bAdd) * t;
      } else {
        node.colorMul.r = 1; node.colorMul.g = 1; node.colorMul.b = 1;
        node.colorAdd.r = 0; node.colorAdd.g = 0; node.colorAdd.b = 0;
      }
      node.alpha = prev.alpha + (next.alpha - prev.alpha) * t;
      const posInt = Math.trunc(parentFramePos);
      if (prev.visible === false &&
          posInt !== prev.frame &&
          posInt !== next.frame) {
        node.visible = false;
        newDrawThisFrame = false;
      } else {
        node.visible = true;
      }
      node.prevKey = prev;
      node.nextKey = next;
    }
  }
  node.drawThisFrame = newDrawThisFrame;
  if (!newDrawThisFrame) return;
  if (!oldDrawThisFrame && !node.synch && node.innerSprite) {
    forceFrame(node.innerSprite, 0);
  }
  if (node.innerSprite) {
    if (node.synch) {
      const inner = node.innerSprite;
      const innerTotal = inner.totalFrames;
      if (innerTotal > 0) {
        const parentInt = Math.floor(parentFramePos);
        let innerFrame = parentInt % innerTotal;
        if (innerFrame < 0) innerFrame += innerTotal;
        forceFrame(inner, innerFrame);
        const fractional = parentFramePos - parentInt;
        inner.parentFramePos = innerFrame + fractional;
        const subDt = fractional / UNIVERSAL_FPS;
        for (const sub of inner.children) {
          if (sub.type === "Composite") compositeUpdate(sub, inner.parentFramePos, subDt);
          else if (sub.type === "Sprite") spriteUpdate(sub, subDt);
        }
      }
    } else {
      spriteUpdate(node.innerSprite, dtSeconds);
    }
  }
}

function updateTick(dtSeconds) {
  if (!animationTree) return;
  const tickDelta = dtSeconds * UNIVERSAL_FPS * currentSpeedFactor * attackSpeedMultiplier;
  animationTime += tickDelta;
  const limit = tailEndTick > 0 ? tailEndTick : precomputedTotalTicks;
  if (limit > 0 && animationTime >= limit) {
    if (autoRestart) {
      animationTime = 0;
      resetNodeState(animationTree, true);
      if (rivalTree) resetNodeState(rivalTree, true);
      if (postTree) resetNodeState(postTree, true);
      spriteUpdate(animationTree, 0);
      if (rivalTree) spriteUpdate(rivalTree, 0);
      if (postTree) spriteUpdate(postTree, 0);
      accumulatorMs = 0;
      transportOffsetX = 0;
      transportOffsetY = 0;
    } else if (stopAtEnd) {
      animationTime = limit;
      paused = true;
      return;
    } else {
      animationTime = animationTime - limit;
    }
  }
  if (deathState.active) {
    const speed = Math.max(0.0001, currentSpeedFactor || 1);
    const shaderSeconds = Math.max(0.0001, deathState.duration / speed);
    if (deathState.progress < 1) {
      deathState.progress = Math.min(1, deathState.progress + dtSeconds / shaderSeconds);
    }
    deathState.elapsed += dtSeconds * speed;
    const totalTicks = getDeathTickDuration();
    const totalSeconds = totalTicks / UNIVERSAL_FPS;
    if (deathState.elapsed >= totalSeconds) {
      if (autoRestart) {
        deathState.progress = 0;
        deathState.elapsed = 0;
        animationTime = 0;
        resetNodeState(animationTree, true);
        if (rivalTree) resetNodeState(rivalTree, true);
        if (postTree) resetNodeState(postTree, true);
        spriteUpdate(animationTree, 0);
        if (rivalTree) spriteUpdate(rivalTree, 0);
        if (postTree) spriteUpdate(postTree, 0);
        accumulatorMs = 0;
        transportOffsetX = 0;
        transportOffsetY = 0;
        if (deathSplatterTree) {
          resetNodeState(deathSplatterTree, true);
          forceLoopDisabled(deathSplatterTree);
          spriteUpdate(deathSplatterTree, 0);
        }
      } else {
        deathState.elapsed = totalSeconds;
      }
    }
  }
  const attackDt = dtSeconds * currentSpeedFactor * attackSpeedMultiplier;
  const normalDt = dtSeconds * currentSpeedFactor;
  spriteUpdate(animationTree, attackDt);
  if (rivalVisible && rivalTree) spriteUpdate(rivalTree, attackDt);
  if (postTree && postStartTick >= 0 && animationTime >= postStartTick) {
    spriteUpdate(postTree, normalDt);
  }
  if (deathState.active && deathSplatterTree) {
    const splatDone =
      deathSplatterTree.currentFrame >= deathSplatterTree.totalFrames - 1 &&
      deathSplatterTree.frameCounter >= deathSplatterTree.framerate - 1 &&
      !deathSplatterTree.loopEnabled;
    if (!splatDone) {
      spriteUpdate(deathSplatterTree, normalDt);
    }
  }
}

function mainLoop(now) {
  if (!loopRunning) return;
  loopId = requestAnimationFrame(mainLoop);
  const deltaMs = Math.min(1000, now - lastTimeMs);
  lastTimeMs = now;
  if (!paused) {
    accumulatorMs += deltaMs;
    while (accumulatorMs >= FRAME_TIME_MS) {
      accumulatorMs -= FRAME_TIME_MS;
      updateTick(1 / SIMULATION_FPS);
    }
  } else accumulatorMs = 0;
  triggerRender();
}

function startLoop() {
  if (loopRunning) return;
  loopRunning = true;
  lastTimeMs = performance.now();
  accumulatorMs = 0;
  loopId = requestAnimationFrame(mainLoop);
}

function stopLoop() {
  loopRunning = false;
  if (loopId !== null) { cancelAnimationFrame(loopId); loopId = null; }
}

function resetNodeState(node, startAtZero = false) {
  if (!node) return;
  if (node.type === "Sprite") {
    node.frameAccumulator = 0;
    node.frameCounter = 0;
    node.currentFrame = startAtZero ? 0 : -1;
    node.delayCounter = 0;
    node.hasLoopedThisFrame = false;
    node.loopEnabled = true;
    node.parentFramePos = 0;
    node.frameTicksElapsed = 0;
  } else if (node.type === "Composite") {
    node.x = 0; node.y = 0; node.angle = 0;
    node.scaleX = 1; node.scaleY = 1;
    node.colorMul = { r: 1, g: 1, b: 1 };
    node.colorAdd = { r: 0, g: 0, b: 0 };
    node.alpha = 1; node.visible = true;
    node.prevKey = null; node.nextKey = null;
    node.drawThisFrame = true;
  }
  if (node.children) for (const c of node.children) resetNodeState(c, startAtZero);
  if (node.type === "Composite" && node.innerSprite) resetNodeState(node.innerSprite, startAtZero);
}

function forceLoopEnabled(node) {
  if (!node) return;
  if (node.type === "Sprite") {
    node.loopEnabled = true;
    for (const c of node.children) forceLoopEnabled(c);
  } else if (node.type === "Composite") {
    if (node.innerSprite) forceLoopEnabled(node.innerSprite);
  }
}

function forceLoopDisabled(node) {
  if (!node) return;
  if (node.type === "Sprite") {
    node.loopEnabled = false;
    for (const c of node.children) forceLoopDisabled(c);
  } else if (node.type === "Composite") {
    if (node.innerSprite) forceLoopDisabled(node.innerSprite);
  }
}

function resetRuntime() {
  animationTime = 0;
  accumulatorMs = 0;
  transportOffsetX = 0;
  transportOffsetY = 0;
  if (animationTree) resetNodeState(animationTree);
  if (rivalTree) resetNodeState(rivalTree);
  if (animationTree) spriteUpdate(animationTree, 0);
  if (rivalTree) spriteUpdate(rivalTree, 0);
  triggerRender();
}

function captureTreeState(node) {
  if (!node) return null;
  if (node.type === "Sprite") {
    return {
      cf: node.currentFrame, fc: node.frameCounter, dc: node.delayCounter,
      fte: node.frameTicksElapsed, fa: node.frameAccumulator, pfp: node.parentFramePos,
      ch: node.children.map(captureTreeState),
    };
  }
  if (node.type === "Composite") {
    return {
      x: node.x, y: node.y, a: node.angle,
      sx: node.scaleX, sy: node.scaleY,
      al: node.alpha, v: node.visible ? 1 : 0,
      mr: node.colorMul.r, mg: node.colorMul.g, mb: node.colorMul.b,
      ar: node.colorAdd.r, ag: node.colorAdd.g, ab: node.colorAdd.b,
      in: node.innerSprite ? captureTreeState(node.innerSprite) : null,
    };
  }
  return null;
}

function restoreTreeState(node, snap) {
  if (!node || !snap) return;
  if (node.type === "Sprite") {
    node.currentFrame = snap.cf;
    node.frameCounter = snap.fc;
    node.delayCounter = snap.dc;
    node.frameTicksElapsed = snap.fte;
    node.frameAccumulator = snap.fa;
    node.parentFramePos = snap.pfp;
    for (let i = 0; i < node.children.length; i++) restoreTreeState(node.children[i], snap.ch[i]);
  } else if (node.type === "Composite") {
    node.x = snap.x; node.y = snap.y; node.angle = snap.a;
    node.scaleX = snap.sx; node.scaleY = snap.sy;
    node.alpha = snap.al; node.visible = !!snap.v;
    node.colorMul.r = snap.mr; node.colorMul.g = snap.mg; node.colorMul.b = snap.mb;
    node.colorAdd.r = snap.ar; node.colorAdd.g = snap.ag; node.colorAdd.b = snap.ab;
    if (node.innerSprite) restoreTreeState(node.innerSprite, snap.in);
  }
}

function precomputeTimeline() {
  if (!animationTree) { precomputedSnapshots = null; precomputedTotalTicks = 0; return; }
  if (loopRunning) return;
  const savedSpeed = currentSpeedFactor;
  const savedAutoRestart = autoRestart;
  const savedStopAtEnd = stopAtEnd;
  const savedPaused = paused;
  currentSpeedFactor = 1;
  autoRestart = false;
  stopAtEnd = false;
  paused = false;
  const savedSnapshots = precomputedSnapshots;
  const savedTotalTicks = precomputedTotalTicks;
  precomputedSnapshots = null;
  precomputedTotalTicks = 0;
  try {
    resetNodeState(animationTree);
    spriteUpdate(animationTree, 0);
    let baseTotal = 0;
    for (let i = 0; i < animationTree.frames.length; i++) {
      baseTotal += getFrameTickDuration(animationTree, i);
    }
    baseTotal = Math.max(1, baseTotal);
    const MAX_SNAPSHOTS = 2000;
    const MAX_ITER = Math.min(MAX_SNAPSHOTS, baseTotal + 200);
    const snapshots = new Array(MAX_ITER);
    let length = 0;
    snapshots[length++] = { tree: captureTreeState(animationTree) };
    const randBackup = Math.random;
    let seed = 0x12345678;
    Math.random = function () {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return (seed & 0x7fffffff) / 0x7fffffff;
    };
    try {
      for (let t = 1; t < MAX_ITER; t++) {
        spriteUpdate(animationTree, 1 / UNIVERSAL_FPS);
        snapshots[length++] = { tree: captureTreeState(animationTree) };
        if (animationTree.hasLoopedThisFrame) break;
      }
    } finally {
      Math.random = randBackup;
    }
    snapshots.length = length;
    precomputedSnapshots = snapshots;
    precomputedTotalTicks = length - 1;
    resetNodeState(animationTree);
    spriteUpdate(animationTree, 0);
  } catch (e) {
    precomputedSnapshots = savedSnapshots;
    precomputedTotalTicks = savedTotalTicks;
    throw e;
  } finally {
    currentSpeedFactor = savedSpeed;
    autoRestart = savedAutoRestart;
    stopAtEnd = savedStopAtEnd;
    paused = savedPaused;
  }
}

function restoreTick(tick) {
  if (!animationTree) return;
  if (deathState.active) {
    const total = getDeathTickDuration();
    let t = Math.trunc(tick);
    if (t < 0) t = 0;
    if (t >= total) t = total - 1;
    deathState.elapsed = t / UNIVERSAL_FPS;
    const shaderSeconds = Math.max(0.0001, deathState.duration);
    deathState.progress = Math.min(1, deathState.elapsed / shaderSeconds);
    if (precomputedSnapshots && precomputedTotalTicks > 0) {
      const standTotal = precomputedTotalTicks;
      let st = t % standTotal;
      if (st < 0) st += standTotal;
      const snap = precomputedSnapshots[st];
      if (snap) restoreTreeState(animationTree, snap.tree);
      animationTime = st;
    } else {
      resetNodeState(animationTree);
      const savedSpeed = currentSpeedFactor;
      currentSpeedFactor = 1;
      spriteUpdate(animationTree, t / UNIVERSAL_FPS);
      currentSpeedFactor = savedSpeed;
      refreshComposites(animationTree);
      animationTime = t;
    }
    if (deathSplatterTree) {
      resetNodeState(deathSplatterTree, true);
      forceLoopDisabled(deathSplatterTree);
      spriteUpdate(deathSplatterTree, t / UNIVERSAL_FPS);
    }
    triggerRender();
    return;
  }
  let t = Math.trunc(tick);
  if (t < 0) t = 0;
  const attackTotal = precomputedTotalTicks > 0 ? precomputedTotalTicks : animationTree.totalFrames;
  const limit = tailEndTick > 0 ? tailEndTick : attackTotal;
  if (t >= limit) t = limit - 1;
  const inTail = tailEndTick > 0 && postTree && postStartTick >= 0 && t >= postStartTick;
  if (precomputedSnapshots && precomputedTotalTicks > 0) {
    const st = Math.min(t, precomputedTotalTicks - 1);
    const snap = precomputedSnapshots[st];
    if (snap) restoreTreeState(animationTree, snap.tree);
  } else {
    resetNodeState(animationTree);
    const savedSpeed = currentSpeedFactor;
    currentSpeedFactor = 1;
    spriteUpdate(animationTree, Math.min(t, attackTotal - 1) / UNIVERSAL_FPS);
    currentSpeedFactor = savedSpeed;
    refreshComposites(animationTree);
  }
  if (inTail) {
    resetNodeState(postTree, true);
    const tailTicks = t - postStartTick;
    if (tailTicks > 0) spriteUpdate(postTree, tailTicks / UNIVERSAL_FPS);
    else spriteUpdate(postTree, 0);
  }
  animationTime = t;
  triggerRender();
}

function setSpritesheet(image) { loadedImage = image || null; window.animationRenderer.clearTintCache(); }

function setTree(root) {
  animationTree = root || null;
  paused = false;
  clearAttackTail();
  precomputedSnapshots = null;
  precomputedTotalTicks = 0;
  resetRuntime();
  if (animationTree) { precomputeTimeline(); resetRuntime(); }
  if (animationTree && !loopRunning) startLoop();
}

function setRivalSpritesheet(image) { rivalImage = image || null; window.animationRenderer.clearTintCache(); }

function setRivalTree(root, loop = true) {
  rivalTree = root || null;
  if (rivalTree) {
    resetNodeState(rivalTree);
    if (loop) forceLoopEnabled(rivalTree);
    spriteUpdate(rivalTree, 0);
  }
}
function setRivalVisible(v) { rivalVisible = !!v; triggerRender(); }

function setTransportOffset(x, y) { transportOffsetX = Number(x) || 0; transportOffsetY = Number(y) || 0; }

function getTransportOffset() { return { x: transportOffsetX, y: transportOffsetY }; }

function getDataPoint(name) {
  if (!animationTree || !animationTree.dataPoints) return null;
  const dp = animationTree.dataPoints.find(d => d.name === name);
  return dp ? { x: dp.x, y: dp.y, name: dp.name } : null;
}

function getDataPoints() {
  if (!animationTree || !animationTree.dataPoints) return [];
  return animationTree.dataPoints.map(d => ({ x: d.x, y: d.y, name: d.name }));
}

function scanAnimationLabels() {
  if (!animationTree || !animationTree.frames) return {};
  const result = {};
  for (let i = 0; i < animationTree.frames.length; i++) {
    const fd = animationTree.frames[i];
    if (!fd || !fd.tags) continue;
    for (const tag of fd.tags) {
      if (tag.key === "label" && !(tag.value in result)) result[tag.value] = i;
    }
  }
  return result;
}

function scanAnimationSounds() {
  if (!animationTree || !animationTree.frames) return [];
  const result = [];
  const fr = Math.max(1, animationTree.framerate || 1);
  let acc = 0;
  let prevSound = null;
  for (let i = 0; i < animationTree.frames.length; i++) {
    const fd = animationTree.frames[i];
    let sound = null;
    if (fd && fd.tags) {
      for (const tag of fd.tags) {
        if (tag.key === "sound") { sound = tag.value; break; }
      }
    }
    if (sound && sound !== prevSound) result.push({ tick: acc, name: sound });
    prevSound = sound;
    acc += fr + ((fd && fd.delay) || 0);
  }
  return result;
}

function stepFrames(delta) {
  if (!animationTree) return;
  const d = Math.trunc(delta);
  if (d === 0) return;
  const rootFramerate = Math.max(1, animationTree.framerate);
  const ticks = d * rootFramerate;
  stepTree(animationTree, ticks);
  refreshComposites(animationTree);
  triggerRender();
}
function gotoTreeTick(targetTick) { restoreTick(targetTick); }

function gotoFrame(n) {
  if (!animationTree) return;
  const total = animationTree.totalFrames;
  if (total <= 0) return;
  let target = Math.trunc(Number(n));
  if (!Number.isFinite(target)) return;
  target = Math.max(0, Math.min(total - 1, target));
  const base = animationTree.currentFrame < 0 ? 0 : animationTree.currentFrame;
  stepFrames(target - base);
}

function getFrameTickDuration(node, frameIndex) {
  if (!node.frames || frameIndex < 0 || frameIndex >= node.frames.length) return 1;
  const fr = Math.max(1, node.framerate);
  const d = node.frames[frameIndex].delay || 0;
  return fr + d;
}

function getTotalTickDuration(node) {
  if (!node || !node.frames) return 1;
  if (node === animationTree && precomputedTotalTicks > 0) {
    return tailEndTick > 0 ? tailEndTick : precomputedTotalTicks;
  }
  let total = 0;
  for (let i = 0; i < node.frames.length; i++) total += getFrameTickDuration(node, i);
  return Math.max(1, total);
}

function getTickPosition(node) {
  if (!node || !node.frames) return 0;
  if (node === animationTree && precomputedSnapshots) {
    const limit = tailEndTick > 0 ? tailEndTick : precomputedTotalTicks;
    return Math.min(animationTime, limit);
  }
  const n = Math.max(0, node.currentFrame);
  let acc = 0;
  for (let i = 0; i < n && i < node.frames.length; i++) acc += getFrameTickDuration(node, i);
  const curDur = getFrameTickDuration(node, n);
  const inFrame = Math.min(node.frameTicksElapsed || 0, curDur);
  return acc + inFrame;
}

function getDeathTickDuration() {
  const shaderTicks = Math.max(1, Math.round((deathState.duration || 1.7) * UNIVERSAL_FPS));
  let splatTicks = 0;
  if (deathSplatterTree && deathSplatterTree.frames) {
    for (let i = 0; i < deathSplatterTree.frames.length; i++) {
      splatTicks += getFrameTickDuration(deathSplatterTree, i);
    }
  }
  let soundTicks = 0;
  const sm = window.soundManager;
  if (sm && sm.getSoundBuffer) {
    const buf = sm.getSoundBuffer('mutant_death');
    if (buf && !(buf instanceof Promise)) {
      soundTicks = Math.ceil(buf.duration * UNIVERSAL_FPS);
    }
  }
  return Math.max(shaderTicks, splatTicks, soundTicks, 1);
}

function getInfo() {
  if (deathState.active) {
    const total = getDeathTickDuration();
    const pos = deathState.elapsed * UNIVERSAL_FPS;
    return {
      currentFrame: animationTree ? Math.max(0, animationTree.currentFrame) : 0,
      totalFrames: animationTree ? animationTree.totalFrames : 0,
      tickPosition: pos,
      tickDuration: total,
      delayCounter: animationTree ? animationTree.delayCounter : 0,
      paused,
      speed: currentSpeedFactor,
      ticks: pos,
    };
  }
  if (!animationTree) {
    return { currentFrame: 0, totalFrames: 0, tickPosition: 0, tickDuration: 1, paused, speed: currentSpeedFactor };
  }
  return {
    currentFrame: Math.max(0, animationTree.currentFrame),
    totalFrames: animationTree.totalFrames,
    tickPosition: getTickPosition(animationTree),
    tickDuration: getTotalTickDuration(animationTree),
    delayCounter: animationTree.delayCounter,
    paused,
    speed: currentSpeedFactor,
    ticks: animationTime,
  };
}

function setShowHidden(v) { window.animationRenderer.setShowHidden(v); triggerRender(); }
function setShowBounds(v) { window.animationRenderer.setShowBounds(v); triggerRender(); }
function setBoundsColor(c) { window.animationRenderer.setBoundsColor(c); triggerRender(); }
function getShowBounds() { return window.animationRenderer.getShowBounds(); }
function getBoundsColor() { return window.animationRenderer.getBoundsColor(); }
function renderNode(...args) { return window.animationRenderer.renderNode(...args); }
function getTreeBounds(node) { return window.animationRenderer.getTreeBounds(node); }

window.animationEngine = {
  setSpritesheet, setTree, setRivalSpritesheet, setRivalTree,
  getTree: () => animationTree,
  getRivalTree: () => rivalTree,
  getLoadedImage: () => loadedImage,
  getRivalImage: () => rivalImage,
  getRenderTree, getRenderImage,
  setAttackTail, clearAttackTail, getTailEndTick, updateAttackTailAssets,
  setRivalVisible, isRivalVisible: () => rivalVisible,
  startLoop, stopLoop, play, pause, togglePause, isPaused,
  setSpeed, setAttackSpeedMultiplier, getAttackSpeedMultiplier,
  setAutoRestart, getAutoRestart, setStopAtEnd, getStopAtEnd,
  isAtEnd, stepFrames, gotoFrame, gotoTick: gotoTreeTick, updateTick,
  reset: resetRuntime,
  getDataPoint, getDataPoints, scanAnimationLabels,
  setTransportOffset, getTransportOffset,
  getInfo, getTime: () => animationTime,
  getTreeTickDuration: getTotalTickDuration,
  setShowHidden, setShowBounds, setBoundsColor,
  getShowBounds,
  getBoundsColor,
  renderNode, setRenderCallback, getTreeBounds,
  spriteUpdate, resetNodeState, precomputeTimeline, restoreTick, scanAnimationSounds,
  startDeath, stopDeath, isDying, getDeathProgress, getDeathFireColor,
  setDeathSplatter, getDeathSplatter, getDeathTickDuration,
};