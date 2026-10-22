const soundBufferCache = new Map();
const activeSources = new Set();
const MASTER_GAIN = 0.7;
const SOUND_LEVEL_GAINS = [0, 1/9, 4/9, 1];
const SOUND_LEVEL_KEY = "soundLevel";

let audioCtx = null;
let masterGain = null;
let playbackRate = 1;
let soundLevel = loadPersistedSoundLevel();
let soundDirection = -1;
let soundVolume = SOUND_LEVEL_GAINS[soundLevel];

function loadPersistedSoundLevel() {
  try {
    const raw = localStorage.getItem(SOUND_LEVEL_KEY);
    if (raw === null) return 3;
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 3) return n;
  } catch (_) {}
  return 3;
}

function persistSoundLevel() {
  try { localStorage.setItem(SOUND_LEVEL_KEY, String(soundLevel)); } catch (_) {}
}

function ensureAudioCtx() {
  if (!audioCtx) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = MASTER_GAIN * soundVolume;
      masterGain.connect(audioCtx.destination);
    } catch (_) { audioCtx = null; return null; }
  }
  if (audioCtx.state === "suspended" && !soundsPaused) audioCtx.resume().catch(() => {});
  return audioCtx;
}

async function loadSound(name) {
  if (!name) return null;
  if (soundBufferCache.has(name)) return soundBufferCache.get(name);
  const promise = (async () => {
    const ctx = ensureAudioCtx();
    if (!ctx) return null;
    try {
      return await retryResource(async signal => {
        const url = `/sounds/${name}.wav`;
        const res = await fetch(url, { signal });
        if (!res.ok) throw createHttpError(res, url);
        const ab = await res.arrayBuffer();
        return ctx.decodeAudioData(ab);
      }, 10000, `sonido ${name}`);
    } catch (error) {
      console.error(`No se pudo procesar el sonido ${name}.`, error);
      return null;
    }
  })();
  soundBufferCache.set(name, promise);
  const parsed = await promise;
  soundBufferCache.set(name, parsed);
  return parsed;
}

async function preloadSounds(names) {
  const unique = [...new Set((names || []).filter(n => n))];
  if (unique.length === 0) return;
  await Promise.race([
    Promise.all(unique.map(n => loadSound(n))),
    new Promise(r => setTimeout(r, 15000)),
  ]);
}

function playBuffer(buffer, name, offsetSeconds = 0, when = 0) {
  if (soundsPaused) return;
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = playbackRate;
  source.connect(masterGain);
  try {
    const startAt = when > 0 ? Math.max(when, ctx.currentTime) : 0;
    source.start(startAt, offsetSeconds);
    const scheduledAt = startAt > 0 ? startAt : ctx.currentTime;
    source._soundInfo = { name, buffer, startedAt: scheduledAt - offsetSeconds / playbackRate };
    activeSources.add(source);
    source.onended = () => activeSources.delete(source);
  } catch (_) {}
}

function playSound(name, offsetSeconds = 0, when = 0) {
  if (!name) return;
  const cached = soundBufferCache.get(name);
  if (cached instanceof Promise) {
    cached.then(buffer => { if (buffer) playBuffer(buffer, name, offsetSeconds, when); });
    return;
  }
  if (!cached) return;
  playBuffer(cached, name, offsetSeconds, when);
}

function playSoundAtOffset(name, offsetSeconds, when = 0) { playSound(name, offsetSeconds, when); }

function cycleSoundVolume() {
  if (soundLevel === 0) soundDirection = 1;
  else if (soundLevel === 3) soundDirection = -1;
  soundLevel += soundDirection;
  soundVolume = SOUND_LEVEL_GAINS[soundLevel];
  const ctx = ensureAudioCtx();
  if (ctx && masterGain) masterGain.gain.value = MASTER_GAIN * soundVolume;
  persistSoundLevel();
  return soundVolume;
}

function getSoundBuffer(name) {
  const cached = soundBufferCache.get(name);
  if (!cached || cached instanceof Promise) return null;
  return cached;
}

let soundsPaused = false;
let audioNeedsRestart = false;
let pendingSuspend = null;
let pendingResume = null;

function stopAllSounds() {
  soundsPaused = false;
  audioNeedsRestart = true;
  pendingSuspend = null;
  pendingResume = null;
  const ctx = audioCtx;
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  for (const src of activeSources) { try { src.stop(); } catch (_) {} }
  activeSources.clear();
}

function pauseAllSounds() {
  soundsPaused = true;
  audioNeedsRestart = false;
  const ctx = audioCtx;
  if (!ctx || ctx.state === "suspended") {
    pendingSuspend = Promise.resolve();
    return pendingSuspend;
  }
  pendingSuspend = ctx.suspend().catch(() => {});
  return pendingSuspend;
}

function resumeAllSounds() {
  soundsPaused = false;
  audioNeedsRestart = false;
  const ctx = audioCtx;
  if (!ctx) return Promise.resolve();
  const doResume = () => {
    if (ctx.state === "running") return Promise.resolve();
    pendingResume = ctx.resume().catch(() => {});
    return pendingResume;
  };
  if (pendingSuspend) {
    const s = pendingSuspend;
    pendingSuspend = null;
    return s.then(doResume);
  }
  return doResume();
}

function needsAudioRestart() { return audioNeedsRestart; }
function clearAudioRestart() { audioNeedsRestart = false; }

function setPlaybackRate(r) {
  const n = Number(r);
  playbackRate = Number.isFinite(n) && n > 0 ? n : 1;
  for (const src of activeSources) { try { src.playbackRate.value = playbackRate; } catch (_) {} }
}

function setSoundVolume(v) {
  const n = Number(v);
  soundVolume = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
  let bestLevel = 0;
  let bestDist = Infinity;
  for (let i = 0; i < SOUND_LEVEL_GAINS.length; i++) {
    const d = Math.abs(SOUND_LEVEL_GAINS[i] - soundVolume);
    if (d < bestDist) { bestDist = d; bestLevel = i; }
  }
  soundLevel = bestLevel;
  const ctx = ensureAudioCtx();
  if (ctx && masterGain) masterGain.gain.value = MASTER_GAIN * soundVolume;
  persistSoundLevel();
}

function setSoundEnabled(v) { setSoundVolume(v ? 1 : 0); }
function getSoundLevel() { return soundLevel; }
function getSoundVolume() { return soundVolume; }
function isSoundEnabled() { return soundVolume > 0; }
function getPlaybackRate() { return playbackRate; }

window.soundManager = {
  loadSound, preloadSounds, playSound, stopAllSounds,
  pauseAllSounds, resumeAllSounds,
  setSoundEnabled, isSoundEnabled,
  setSoundVolume, getSoundVolume, cycleSoundVolume,
  getSoundLevel,
  setPlaybackRate, getPlaybackRate,
  getSoundBuffer, playSoundAtOffset,
  needsAudioRestart, clearAudioRestart,
  getAudioContext: () => ensureAudioCtx(),
};