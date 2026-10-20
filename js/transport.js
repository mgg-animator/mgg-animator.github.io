function animTickAtFrame(animTree, frameIndex) {
  if (!animTree || !animTree.frames) return 0;
  const n = Math.max(0, Math.min(frameIndex, animTree.frames.length - 1));
  const fr = Math.max(1, animTree.framerate || 1);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const d = (animTree.frames[i] && animTree.frames[i].delay) || 0;
    acc += fr + d;
  }
  return acc;
}

function collectLabelEntryTicks(animTree, labelName) {
  if (!animTree || !animTree.frames) return [];
  const ticks = [];
  const fr = Math.max(1, animTree.framerate || 1);
  let acc = 0;
  let prevHad = false;
  for (let i = 0; i < animTree.frames.length; i++) {
    const fd = animTree.frames[i];
    let has = false;
    if (fd && fd.tags) {
      for (const tag of fd.tags) {
        if (tag.key === "label" && tag.value === labelName) { has = true; break; }
      }
    }
    if (has && !prevHad) ticks.push(acc);
    prevHad = has;
    acc += fr + ((fd && fd.delay) || 0);
  }
  return ticks;
}

async function buildTransportSchedule() {
  const engine = window.animationEngine;
  const scene = window.sceneRenderer;
  lastSeenTick = 0;
  momentIdx = {};
  fxLastTick = -0.001;
  restoreRivalStand();
  window.fxManager.clear();
  window.soundManager.stopAllSounds();
  engine.clearAttackTail();
  const info = engine.getInfo();
  const total = info.totalFrames;
  if (total <= 0) { transportSchedule = null; return; }
  const animValue = selectedAnimation ? (selectedAnimation.value || "") : "";
  if (!ATTACK_PATTERN.test(animValue)) { transportSchedule = null; return; }
  const animTree = engine.getTree();
  if (!animTree) { transportSchedule = null; return; }
  const labels = engine.scanAnimationLabels();
  const moments = {};
  for (const labelName of Object.keys(labels)) {
    const ticks = collectLabelEntryTicks(animTree, labelName);
    if (ticks.length > 0) moments[labelName] = ticks;
  }
  for (const k of Object.keys(moments)) momentIdx[k] = 0;
  if (window.fxManager) {
    const fxDefs = window.fxManager.getCurrentAttacks
      ? window.fxManager.getCurrentAttacks()
      : null;
    const list = fxDefs && fxDefs.list ? fxDefs.list : null;
    if (list) {
      const totalTicks = info.tickDuration || animTickAtFrame(animTree, animTree.frames.length - 1);
      const defaults = {
        start: 0,
        return: animTickAtFrame(animTree, animTree.frames.length - 1),
        back: animTickAtFrame(animTree, animTree.frames.length - 1),
        end: totalTicks,
      };
      for (const def of list) {
        const m = def.moment || "impact";
        if (moments[m] && moments[m].length > 0) continue;
        if (defaults[m] !== undefined) {
          moments[m] = [defaults[m]];
          momentIdx[m] = 0;
        }
      }
    }
  }
  const hasArrived = labels.arrived !== undefined;
  const hasReturn = labels.return !== undefined;
  const hasTeleport = labels.teleport !== undefined;
  const hasBack = labels.back !== undefined;
  const dps = engine.getDataPoints();
  const hasDp = dps.length > 0;
  let targetDeltaX = 0;
  let hasArrivalPhase = false;
  let hasReturnPhase = false;
  let returnIsSnap = false;
  let startTick = 0, arrivedTick = 0, returnTick = 0, backTick = 0;
  if (hasDp && (hasArrived || hasReturn || hasTeleport || hasBack)) {
    hasArrivalPhase = hasArrived;
    hasReturnPhase = true;
    const startFrame = labels.start !== undefined ? labels.start : 0;
    const arrivedFrame = labels.arrived !== undefined ? labels.arrived : (total - 1);
    const backFrame = labels.back !== undefined ? labels.back : (total - 1);
    let returnFrame;
    let returnIsSnap;
    if (hasReturn) {
      returnFrame = labels.return;
      returnIsSnap = false;
    } else if (hasBack) {
      returnFrame = labels.back;
      returnIsSnap = true;
    } else if (hasTeleport) {
      returnFrame = labels.teleport;
      returnIsSnap = true;
    } else {
      returnFrame = backFrame;
      returnIsSnap = true;
    }
    startTick   = animTickAtFrame(animTree, startFrame);
    arrivedTick = animTickAtFrame(animTree, arrivedFrame);
    returnTick  = animTickAtFrame(animTree, returnFrame);
    backTick    = animTickAtFrame(animTree, backFrame);
    const dp = dps[0];
    const arenaScale = scene.getArenaScale();
    const targetRivalIndex = 1;
    const selfSlot = scene.computeFightSlotTransform(1, 3, 0);
    const rivalSlot = scene.computeFightSlotTransform(targetRivalIndex, 3, 1);
    const hitScale = rivalSlot.scale * arenaScale;
    const dxPx = (rivalSlot.x - selfSlot.x) * arenaScale;
    targetDeltaX = dxPx - (hitScale * dp.x);
  }
  transportSchedule = {
    startTick, arrivedTick, returnTick, backTick,
    moments, targetDeltaX,
    hasArrivalPhase, hasReturnPhase, returnIsSnap
  };
  const attackEnd = info.tickDuration;
  const fxEnd = window.fxManager.computeTailEndTick(moments);
  const soundEnd = await computeSoundTailEndTick();
  const tailEnd = Math.max(attackEnd, fxEnd, soundEnd);
  if (tailEnd > attackEnd && window._standAssets) {
    engine.setAttackTail(tailEnd, window._standAssets.tree, window._standAssets.image, attackEnd);
  }
}

function buildSoundSchedule() {
  const animValue = selectedAnimation ? (selectedAnimation.value || "") : "";
  if (DEATH_PATTERN.test(animValue)) {
    soundSchedule = [{ tick: 0, name: "mutant_death" }];
  } else {
    soundSchedule = window.animationEngine.scanAnimationSounds() || [];
  }
  updateSoundButtonState();
}

function updateTransport() {
  if (!transportSchedule) { window.animationEngine.setTransportOffset(0, 0); return; }
  const {
    startTick, arrivedTick, returnTick, backTick,
    targetDeltaX,
    hasArrivalPhase, hasReturnPhase, returnIsSnap
  } = transportSchedule;
  const tick = window.animationEngine.getInfo().tickPosition || 0;
  let x = 0;
  if (hasArrivalPhase && hasReturnPhase) {
    if (tick <= startTick) x = 0;
    else if (tick < arrivedTick) x = targetDeltaX * ((tick - startTick) / (arrivedTick - startTick));
    else if (tick < returnTick) x = targetDeltaX;
    else if (returnIsSnap) x = 0;
    else if (tick < backTick) {
      const span = backTick - returnTick;
      x = span > 0 ? targetDeltaX * (1 - (tick - returnTick) / span) : 0;
    }
    else x = 0;
  } else if (hasArrivalPhase) {
    if (tick <= startTick) x = 0;
    else if (tick < arrivedTick) x = targetDeltaX * ((tick - startTick) / (arrivedTick - startTick));
    else x = targetDeltaX;
  } else if (hasReturnPhase) {
    if (tick < returnTick) x = targetDeltaX;
    else if (returnIsSnap) x = 0;
    else if (tick < backTick) {
      const span = backTick - returnTick;
      x = span > 0 ? targetDeltaX * (1 - (tick - returnTick) / span) : 0;
    }
    else x = 0;
  }
  window.animationEngine.setTransportOffset(x, 0);
}

function playResumeSoundForTick(targetTick) {
  if (!soundSchedule || soundSchedule.length === 0) return;
  let best = null;
  for (const s of soundSchedule) {
    if (s.tick <= targetTick) {
      if (!best || s.tick > best.tick) best = s;
    }
  }
  if (!best) return;
  const elapsedTicks = targetTick - best.tick;
  const attackMult = window.animationEngine.getAttackSpeedMultiplier();
  const offsetSeconds = elapsedTicks / (30 * attackMult);
  const buffer = window.soundManager.getSoundBuffer(best.name);
  if (!buffer) return;
  if (offsetSeconds >= buffer.duration) return;
  window.soundManager.playSoundAtOffset(best.name, offsetSeconds);
}

async function computeSoundTailEndTick() {
  if (!soundSchedule || soundSchedule.length === 0) return 0;
  await Promise.all(soundSchedule.map(s => window.soundManager.loadSound(s.name)));
  const attackSpeedMult = window.animationEngine.getAttackSpeedMultiplier();
  let maxEnd = 0;
  for (const s of soundSchedule) {
    const buf = window.soundManager.getSoundBuffer(s.name);
    const dur = buf ? buf.duration : 2;
    const end = s.tick + dur * 30 * attackSpeedMult;
    if (end > maxEnd) maxEnd = end;
  }
  return maxEnd;
}

function checkSoundCrossings(prevTick, currTick, maxDelta = 5) {
  if (!soundSchedule || soundSchedule.length === 0) return;
  const delta = currTick - prevTick;
  if (delta <= 0.0001) return;
  if (maxDelta !== null && delta > maxDelta) return;
  for (const s of soundSchedule) {
    if (s.tick > prevTick && s.tick <= currTick) {
      window.soundManager.playSound(s.name);
    }
  }
}

function checkMomentTicks() {
  if (!transportSchedule || !transportSchedule.moments) return;
  const tick = window.animationEngine.getInfo().tickPosition || 0;
  for (const name of Object.keys(transportSchedule.moments)) {
    const list = transportSchedule.moments[name];
    let idx = momentIdx[name] || 0;
    while (idx < list.length && list[idx] <= tick) {
      window.fxManager.onLabelMoment(name);
      if (name === "impact") activateRivalHit(0);
      idx++;
    }
    momentIdx[name] = idx;
  }
}

function updateMomentIdxForTick(targetTick) {
  if (!transportSchedule || !transportSchedule.moments) return;
  for (const name of Object.keys(transportSchedule.moments)) {
    const list = transportSchedule.moments[name];
    let idx = 0;
    while (idx < list.length && list[idx] <= targetTick) idx++;
    momentIdx[name] = idx;
  }
}

function rebuildFxForTick(targetTick) {
  window.fxManager.clear();
  if (!transportSchedule || !transportSchedule.moments) return;
  const events = [];
  for (const name of Object.keys(transportSchedule.moments)) {
    for (const tk of transportSchedule.moments[name]) {
      if (tk <= targetTick) events.push({ name, tick: tk });
    }
  }
  if (events.length === 0) return;
  events.sort((a, b) => a.tick - b.tick);
  let prevTick = 0;
  for (const ev of events) {
    if (ev.tick > prevTick) { window.fxManager.advanceTicks(ev.tick - prevTick); prevTick = ev.tick; }
    window.fxManager.onLabelMoment(ev.name);
  }
  if (targetTick > prevTick) window.fxManager.advanceTicks(targetTick - prevTick);
}

function restoreRivalHitForTick(targetTick) {
  const impactTicks = transportSchedule && transportSchedule.moments && transportSchedule.moments.impact;
  if (!impactTicks || impactTicks.length === 0 || !currentRivalAssets || !currentRivalAssets.hit) {
    if (rivalHitPlaying) { restoreRivalStand(); rivalHitPlaying = false; }
    return;
  }
  let lastImpact = -1;
  for (const tk of impactTicks) { if (tk <= targetTick) lastImpact = tk; else break; }
  if (lastImpact < 0) {
    if (rivalHitPlaying) { restoreRivalStand(); rivalHitPlaying = false; }
    return;
  }
  const hitDuration = window.animationEngine.getTreeTickDuration(currentRivalAssets.hit.tree);
  const elapsed = targetTick - lastImpact;
  if (elapsed < hitDuration) {
    activateRivalHit(elapsed);
  } else if (rivalHitPlaying) {
    restoreRivalStand();
    rivalHitPlaying = false;
  }
}

function activateRivalHit(elapsedTicks = 0) {
  if (!currentRivalAssets || !currentRivalAssets.hit) return;
  const hitTree = currentRivalAssets.hit.tree;
  const hitDur = window.animationEngine.getTreeTickDuration(hitTree);
  window.animationEngine.setRivalSpritesheet(currentRivalAssets.hit.img);
  window.animationEngine.setRivalTree(hitTree, false);
  hitTree.loopEnabled = false;
  if (elapsedTicks > 0) {
    const savedSpeed = window.animationEngine.getInfo().speed;
    window.animationEngine.setSpeed(1);
    window.animationEngine.spriteUpdate(hitTree, elapsedTicks / 30);
    window.animationEngine.setSpeed(savedSpeed);
  }
  rivalHitPlaying = true;
  rivalHitTicksElapsed = elapsedTicks;
  rivalHitDurationTicks = hitDur;
}

function applyTickToAll(targetTick, opts = {}) {
  const { silent = false } = opts;
  const prevTick = fxLastTick;
  window.animationEngine.gotoTick(targetTick);
  rebuildFxForTick(targetTick);
  updateMomentIdxForTick(targetTick);
  restoreRivalHitForTick(targetTick);
  window.soundManager.stopAllSounds();
  if (!silent) checkSoundCrossings(prevTick, targetTick, null);
  fxLastTick = targetTick;
  lastSeenTick = targetTick;
  lastAnimationTime = window.animationEngine.getTime();
  updateTransport();
}

function stepTimeline(direction) {
  if (!Number.isFinite(direction) || direction === 0) return;
  const info = window.animationEngine.getInfo();
  const dur = info.tickDuration || 1;
  if (dur <= 0) return;
  const current = info.tickPosition || 0;
  const lastTick = Math.max(0, dur - 1);
  const currentFrame = Math.floor(Math.max(0, Math.min(lastTick, current)));
  if ((direction < 0 && currentFrame <= 0) || (direction > 0 && currentFrame >= lastTick)) return;
  const target = Math.max(0, Math.min(lastTick, currentFrame + Math.sign(direction)));
  if (target === current) return;
  applyTickToAll(target);
  timelineLastFrame = -1;
  updateTimelineBar();
  updateStepButtonStates();
}

function updateRivalHitProgress() {
  const engine = window.animationEngine;
  const current = engine.getTime();
  const delta = current - lastAnimationTime;
  lastAnimationTime = current;
  if (!rivalHitPlaying) return;
  if (delta <= 0) return;
  rivalHitTicksElapsed += delta;
  if (rivalHitTicksElapsed >= rivalHitDurationTicks) {
    rivalHitPlaying = false;
    if (currentRivalAssets && currentRivalAssets.stand) {
      engine.setRivalSpritesheet(currentRivalAssets.stand.img);
      engine.setRivalTree(currentRivalAssets.stand.tree);
    }
  }
}