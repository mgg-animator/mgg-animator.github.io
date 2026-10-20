function updatePlayButtonIcon() {
  const img = btnPlay.querySelector("img");
  if (!img) return;
  const desired = window.animationEngine.isPaused()
    ? "/images/ui/icons/players/player_play.png"
    : "/images/ui/icons/players/player_pause.png";
  if (img.src.indexOf(desired) === -1) img.src = desired;
}

function updateLoopButtonIcon() {
  const img = btnLoop.querySelector("img");
  if (!img) return;
  const desired = loopEnabled
    ? "/images/ui/icons/players/player_loop.png"
    : "/images/ui/icons/players/player_noloop.png";
  if (img.src.indexOf(desired) === -1) img.src = desired;
}

function updateSoundButtonIcon() {
  const img = btnSound.querySelector("img");
  if (!img) return;
  const level = window.soundManager.getSoundLevel();
  const name = level === 3 ? "player_sound_3.png"
             : level === 2 ? "player_sound_2.png"
             : level === 1 ? "player_sound_1.png"
             : "player_sound_off.png";
  const desired = `/images/ui/icons/players/${name}`;
  if (img.src.indexOf(desired) === -1) img.src = desired;
}

function setupSoundControl() {
  btnSound.addEventListener("click", () => {
    window.soundManager.cycleSoundVolume();
    updateSoundButtonIcon();
  });
  updateSoundButtonIcon();
}

function bindHoldButton(button, onPress, repeatMs = 100, initialDelayMs = 300) {
  let initialTimeout = null;
  let repeatInterval = null;
  let holding = false;
  const start = (e) => {
    if (e) e.preventDefault();
    if (holding) return;
    holding = true;
    onPress();
    initialTimeout = setTimeout(() => { repeatInterval = setInterval(onPress, repeatMs); }, initialDelayMs);
  };
  const stop = () => {
    if (!holding) return;
    holding = false;
    clearTimeout(initialTimeout); clearInterval(repeatInterval);
    initialTimeout = null; repeatInterval = null;
  };
  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointerleave", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("contextmenu", (e) => e.preventDefault());
}

function setupLoopControl() {
  btnLoop.addEventListener("click", () => {
    loopEnabled = !loopEnabled;
    window.animationEngine.setStopAtEnd(!loopEnabled);
    const anim = selectedAnimation ? (selectedAnimation.value || "stand") : "stand";
    const isCombat = COMBAT_PATTERN.test(anim) || DEATH_PATTERN.test(anim);
    window.animationEngine.setAutoRestart(loopEnabled && isCombat);
    updateLoopButtonIcon();
  });
  window.animationEngine.setStopAtEnd(!loopEnabled);
  updateLoopButtonIcon();
}

function setupPlaybackControls() {
  btnPlay.addEventListener("click", async () => {
    const wasPaused = window.animationEngine.isPaused();
    const info = window.animationEngine.getInfo();
    if (wasPaused) {
      const tick = info.tickPosition || 0;
      if (window.animationEngine.isAtEnd() || tick < 0.5) {
        window.animationEngine.gotoTick(0);
        fxLastTick = 0;
        lastSeenTick = 0;
        momentIdx = {};
        await window.soundManager.resumeAllSounds();
        playResumeSoundForTick(0);
        window.soundManager.clearAudioRestart();
      } else if (window.soundManager.needsAudioRestart()) {
        fxLastTick = tick;
        lastSeenTick = tick;
        await window.soundManager.resumeAllSounds();
        playResumeSoundForTick(tick);
        window.soundManager.clearAudioRestart();
      } else {
        fxLastTick = tick;
        lastSeenTick = tick;
        await window.soundManager.resumeAllSounds();
      }
      window.animationEngine.play();
    } else {
      window.animationEngine.pause();
      window.soundManager.pauseAllSounds();
    }
    updatePlayButtonIcon();
  });
  bindHoldButton(btnBack, () => {
    if (!window.animationEngine.isPaused()) { window.animationEngine.pause(); updatePlayButtonIcon(); }
    stepTimeline(-1);
  });
  bindHoldButton(btnForward, () => {
    if (!window.animationEngine.isPaused()) { window.animationEngine.pause(); updatePlayButtonIcon(); }
    stepTimeline(1);
  });
  btnStop.addEventListener("click", () => {
    applyTickToAll(0);
    window.animationEngine.pause();
    timelineLastFrame = -1;
    updateTimelineBar();
    updatePlayButtonIcon();
  });
  updatePlayButtonIcon();
}

function setPlayerButtonEnabled(btn, enabled) {
  if (!btn) return;
  const isEnabled = !btn.disabled && !btn.classList.contains("btnPlayerOff");
  const isDisabled = btn.disabled && btn.classList.contains("btnPlayerOff");
  if (enabled ? isEnabled : isDisabled) return;
  if (enabled) {
    btn.classList.remove("btnPlayerOff");
    btn.classList.add("btn", "btnPlayer");
    btn.disabled = false;
  } else {
    btn.classList.remove("btn", "btnPlayer");
    btn.classList.add("btnPlayerOff");
    btn.disabled = true;
  }
}

function updateStepButtonStates(info = window.animationEngine.getInfo()) {
  const playerReady = btnPlay && !btnPlay.disabled;
  const duration = Number(info.tickDuration);
  const position = Number(info.tickPosition) || 0;
  const lastTick = Math.max(0, duration - 1);
  const hasDuration = Number.isFinite(duration) && duration > 0;
  const currentFrame = Math.floor(Math.max(0, Math.min(lastTick, position)));
  setPlayerButtonEnabled(btnBack, playerReady && hasDuration && currentFrame > 0);
  setPlayerButtonEnabled(btnForward, playerReady && hasDuration && currentFrame < lastTick);
}

function updateSoundButtonState() {
  if (!btnSound) return;
  const playerReady = !btnPlay.disabled;
  const hasSounds = soundSchedule && soundSchedule.length > 0;
  setPlayerButtonEnabled(btnSound, playerReady && hasSounds);
  if (!btnSound.disabled) updateSoundButtonIcon();
}

function enablePlayerButtons() {
  const canvas = document.getElementById("mutantCanvas");
  if (canvas && firstMutantLoaded) canvas.style.cursor = "grab";
  playerButtons.forEach(btn => {
    if (!btn || btn === btnSound) return;
    setPlayerButtonEnabled(btn, true);
  });
  updateSoundButtonState();
}

function applyCurrentSpeed() {
  if (availableSpeeds.length === 0) return;
  const speed = availableSpeeds[currentSpeedIndex];
  const span = btnSpeed.querySelector("span");
  if (span) span.textContent = speed.name;
  const value = parseFloat(speed.value);
  const factor = Number.isFinite(value) ? value : 1;
  window.animationEngine.setSpeed(factor);
  window.soundManager.setPlaybackRate(factor);
}

function setupSpeedControl() {
  btnSpeed.addEventListener("click", () => {
    if (availableSpeeds.length === 0) return;
    currentSpeedIndex = (currentSpeedIndex + 1) % availableSpeeds.length;
    applyCurrentSpeed();
  });
  applyCurrentSpeed();
}