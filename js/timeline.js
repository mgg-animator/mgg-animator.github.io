function getTimelineGeometry() {
  const rect = playerTimeline.getBoundingClientRect();
  const localWidth = playerTimeline.offsetWidth;
  const scale = localWidth > 0 ? rect.width / localWidth : 1;
  const lineStart = playerLine.offsetLeft;
  const lineWidth = playerLine.offsetWidth;
  const barWidth = playerBar.offsetWidth;
  const range = Math.max(1, lineWidth - barWidth);
  return { rect, scale, lineStart, lineWidth, barWidth, range };
}

function updateTimelineBar() {
  const info = window.animationEngine.getInfo();
  if (info.totalFrames <= 0) return;
  const { lineStart, range } = getTimelineGeometry();
  if (timelineDragging) {
    playerBar.style.left = `${lineStart + timelineLastFrame * range}px`;
    return;
  }
  const dur = info.tickDuration || 1;
  const pos = info.tickPosition || 0;
  const lastTick = Math.max(1, Math.ceil(dur) - 1);
  const ratio = Math.max(0, Math.min(1, pos / lastTick));
  if (Math.abs(ratio - timelineLastFrame) < 0.0001) return;
  timelineLastFrame = ratio;
  playerBar.style.left = `${lineStart + ratio * range}px`;
}

function seekTimeline(clientX) {
  const info = window.animationEngine.getInfo();
  const dur = info.tickDuration || 1;
  if (info.totalFrames <= 0 || dur <= 0) return;
  const lastTick = Math.max(0, Math.ceil(dur) - 1);
  const { rect, scale, lineStart, barWidth, range } = getTimelineGeometry();
  const localX = (clientX - rect.left) / scale;
  const relative = localX - lineStart - barWidth / 2;
  const ratio = Math.max(0, Math.min(1, relative / range));
  const target = Math.round(ratio * lastTick);
  applyTickToAll(target, { silent: true });
  timelineLastFrame = ratio;
  playerBar.style.left = `${lineStart + ratio * range}px`;
}

function startTimelineDrag(clientX) {
  timelineDragging = true;
  timelineDraggingPaused = window.animationEngine.isPaused();
  window.animationEngine.pause();
  window.soundManager.stopAllSounds();
  updatePlayButtonIcon();
  playerTimeline.classList.add("dragging");
  seekTimeline(clientX);
}

function endTimelineDrag() {
  if (!timelineDragging) return;
  timelineDragging = false;
  playerTimeline.classList.remove("dragging");
  timelineLastFrame = -1;
  updateTimelineBar();
  const tick = window.animationEngine.getInfo().tickPosition || 0;
  if (!timelineDraggingPaused) {
    window.soundManager.stopAllSounds();
    const ctx = window.soundManager.getAudioContext();
    const lookaheadMs = 30;
    const lookaheadSec = lookaheadMs / 1000;
    const when = ctx ? ctx.currentTime + lookaheadSec : 0;
    playResumeSoundForTick(tick, when);
    window.animationEngine.pause();
    setTimeout(() => {
      window.animationEngine.play();
      fxLastTick = tick;
      lastSeenTick = tick;
      updatePlayButtonIcon();
    }, lookaheadMs);
  } else {
    fxLastTick = tick;
    lastSeenTick = tick;
  }
}

function setupTimeline() {
  playerTimeline.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startTimelineDrag(e.clientX);
  });
  window.addEventListener("pointermove", (e) => {
    if (timelineDragging) seekTimeline(e.clientX);
  });
  window.addEventListener("pointerup", () => {
    if (timelineDragging) endTimelineDrag();
  });
  window.addEventListener("pointercancel", () => {
    if (timelineDragging) endTimelineDrag();
  });
  let wasPaused = null;
  let lastPausedTick = null;
  const timelineLoop = () => {
    requestAnimationFrame(timelineLoop);
    const info = window.animationEngine.getInfo();
    const tick = info.tickPosition || 0;
    const dur = info.tickDuration || 1;
    updateStepButtonStates(info);
    if (info.paused) {
      updatePlayButtonIcon();
      if (wasPaused !== true || tick !== lastPausedTick) {
        updateTimelineBar();
        updateTransport();
        updateRivalHitProgress();
      }
      fxLastTick = tick;
      wasPaused = true;
      lastPausedTick = tick;
      return;
    }
    wasPaused = false;
    updateTimelineBar();
    updatePlayButtonIcon();
    updateTransport();
    updateRivalHitProgress();
    const prevTick = fxLastTick;
    const delta = tick - prevTick;
    if (delta > 0.0001 && delta < 15) {
      window.fxManager.advanceTicks(delta);
      checkMomentTicks();
      checkSoundCrossings(prevTick, tick, 15);
      fxLastTick = tick;
      return;
    }
    if (Math.abs(delta) < 0.0001) return;
    const isLoop = tick < prevTick;
    rebuildFxForTick(tick);
    updateMomentIdxForTick(tick);
    if (isLoop) {
      window.soundManager.stopAllSounds();
      checkSoundCrossings(prevTick, dur, null);
      checkSoundCrossings(-0.001, tick, null);
    } else {
      checkSoundCrossings(prevTick, tick, null);
    }
    fxLastTick = tick;
    lastSeenTick = tick;
  };
  timelineLoop();
}