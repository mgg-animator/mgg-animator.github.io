const fxCache = new Map();
const fxSpriteCache = new Map();
const objectColorTransforms = {
  self:       { rMul: 1, gMul: 1, bMul: 1, rAdd: 0, gAdd: 0, bAdd: 0 },
  target:     { rMul: 1, gMul: 1, bMul: 1, rAdd: 0, gAdd: 0, bAdd: 0 },
  background: { rMul: 1, gMul: 1, bMul: 1, rAdd: 0, gAdd: 0, bAdd: 0 },
};

let currentAttacks = null;
let activeFx = [];
let effectsEnabled = true;
let lightsEnabled = true;
let currentFxSkin = "";
let currentTargetCount = 1;

function setTargetCount(n) {
  const v = Math.floor(Number(n));
  currentTargetCount = (Number.isFinite(v) && v >= 1) ? v : 1;
}

function setFxSkin(skin) {
  const n = (skin === undefined || skin === null) ? "" : String(skin).trim();
  if (n === currentFxSkin) return;
  currentFxSkin = n;
  for (const fx of activeFx) {
    if (fx.kind !== "sprite") continue;
    fx.skin = n;
    const states = fx.particles.map(p => ({
      started: p.started,
      done: p.done,
      playTime: p.playTime,
      cyclesDone: p.cyclesDone,
      elapsed: p.elapsed,
    }));
    const applyAsset = (asset) => {
      if (!asset) return;
      if (fx.skin !== n) return;
      fx.asset = asset;
      const cycleDur = computeTreeDuration(asset.tree);
      for (let i = 0; i < fx.particles.length; i++) {
        const p = fx.particles[i];
        const st = states[i];
        p.tree = cloneTree(asset.tree);
        p.cycleDuration = cycleDur;
        p.started = st.started;
        p.done = st.done;
        p.playTime = st.playTime;
        p.cyclesDone = st.cyclesDone;
        p.elapsed = st.elapsed;
        if (st.started && !st.done && st.playTime > 0) {
          const elapsedInCycle = st.playTime - st.cyclesDone * cycleDur;
          if (elapsedInCycle > 0) {
            window.animationEngine.spriteUpdate(p.tree, elapsedInCycle);
          }
        }
      }
    };
    const cacheKey = `${fx.name}|${n}`;
    const cached = fxSpriteCache.get(cacheKey);
    if (cached && !(cached instanceof Promise)) {
      applyAsset(cached);
    } else {
      loadSpriteFxAsset(fx.name, n).then(applyAsset);
    }
  }
}

function resetColorTransforms() {
  for (const k of ["self", "target", "background"]) {
    const o = objectColorTransforms[k];
    o.rMul = 1; o.gMul = 1; o.bMul = 1;
    o.rAdd = 0; o.gAdd = 0; o.bAdd = 0;
  }
}

function parseHexColor(str) {
  if (!str) return { r: 1, g: 1, b: 1, a: 1 };
  let s = String(str).trim();
  if (s.toLowerCase() === "normal") return { r: 1, g: 1, b: 1, a: 1 };
  if (s.startsWith("0x")) s = s.slice(2);
  if (s.startsWith("#")) s = s.slice(1);
  let a = 1;
  if (s.length === 8) { a = parseInt(s.slice(0, 2), 16) / 255; s = s.slice(2); }
  if (s.length === 6) {
    return {
      r: parseInt(s.slice(0, 2), 16) / 255,
      g: parseInt(s.slice(2, 4), 16) / 255,
      b: parseInt(s.slice(4, 6), 16) / 255, a,
    };
  }
  return { r: 1, g: 1, b: 1, a: 1 };
}

function parseApplyOn(str) {
  let s = String(str == null ? "target" : str).trim().toLowerCase();
  if (!s) s = "target";
  if (s[0] !== "+" && s[0] !== "-") s = "+" + s;
  const tokens = s.match(/[+-][a-z]+/g) || [];
  const flags = { self: false, target: false, background: false };
  for (const t of tokens) {
    const sign = t[0] === "+";
    const name = t.slice(1);
    if (name === "allclip") { flags.self = sign; flags.target = sign; }
    else if (name === "self") flags.self = sign;
    else if (name === "target") flags.target = sign;
    else if (name === "background") flags.background = sign;
  }
  return flags;
}

function firstChildByName(node, name) {
  const list = node.getElementsByTagName(name);
  for (let i = 0; i < list.length; i++) {
    if (list[i].parentNode === node) return list[i];
  }
  return null;
}

function cloneTree(node, isRoot = true) {
  if (!node) return null;
  if (node.type === "Sprite") {
    const copy = Object.assign({}, node);
    copy.frames = node.frames.map(f => ({ ...f, images: f.images.slice(), tags: f.tags.slice() }));
    copy.images = node.images.slice();
    copy.frameDurations = node.frameDurations.slice();
    copy.children = node.children.map(c => cloneTree(c, false));
    copy.dataPoints = node.dataPoints.slice();
    copy.frameAccumulator = 0;
    copy.frameCounter = 0;
    copy.currentFrame = -1;
    copy.delayCounter = 0;
    copy.hasLoopedThisFrame = false;
    copy.loopEnabled = isRoot ? false : node.loopEnabled;
    copy.parentFramePos = 0;
    copy.frameTicksElapsed = 0;
    return copy;
  }
  if (node.type === "Composite") {
    const copy = Object.assign({}, node);
    copy.keys = node.keys.slice();
    copy.colorMul = { r: 1, g: 1, b: 1 };
    copy.colorAdd = { r: 0, g: 0, b: 0 };
    copy.innerSprite = node.innerSprite ? cloneTree(node.innerSprite, false) : null;
    copy.prevKey = null; copy.nextKey = null;
    copy.x = 0; copy.y = 0; copy.angle = 0;
    copy.scaleX = 1; copy.scaleY = 1;
    copy.alpha = 1; copy.visible = true;
    return copy;
  }
  return node;
}

function computeTreeDuration(tree, ignoreHold) {
  if (!tree || tree.type !== "Sprite" || !tree.frames) return 1.0;
  const fr = Math.max(1, tree.framerate || 1);
  let totalTicks = 0;
  const lastIdx = tree.frames.length - 1;
  for (let i = 0; i < tree.frames.length; i++) {
    const f = tree.frames[i];
    const delay = f.delay || 0;
    if (ignoreHold && i === lastIdx && delay > 300) continue;
    totalTicks += fr + delay;
  }
  return Math.max(0.1, totalTicks / 30);
}

function getTreeTotalTicks(node) {
  if (!node || node.type !== "Sprite" || !node.frames) return 1;
  const fr = Math.max(1, node.framerate || 1);
  let total = 0;
  for (const f of node.frames) total += fr + (f.delay || 0);
  return Math.max(1, total);
}

function getSpriteCycleDuration(name, skin, ignoreHold) {
  if (!name) return null;
  const n = (skin === undefined) ? currentFxSkin : skin;
  const normalizedSkin = (n === undefined || n === null) ? "" : String(n).trim();
  const cacheKey = `${name}|${normalizedSkin}`;
  const asset = fxSpriteCache.get(cacheKey);
  if (asset && !(asset instanceof Promise) && asset.tree) {
    return computeTreeDuration(asset.tree, ignoreHold);
  }
  return null;
}

function computeSpriteVisualCenter(tree, img) {
  if (!tree || !img) return { cx: 0, cy: 0 };
  const size = 1024;
  const half = size / 2;
  const downscale = 0.25;
  const upscale = 1 / downscale;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const cx2 = canvas.getContext("2d", { willReadFrequently: true });
  let minX = size, minY = size, maxX = 0, maxY = 0, any = false;
  const totalTicks = getTreeTotalTicks(tree);
  const effectiveTicks = Math.min(totalTicks, 300);
  const sampleCount = 8;
  const engine = window.animationEngine;
  const savedSpeed = engine.getInfo().speed;
  engine.setSpeed(1);
  try {
    for (let i = 0; i < sampleCount; i++) {
      const probe = cloneTree(tree);
      const targetTick = Math.floor(effectiveTicks * i / Math.max(1, sampleCount - 1));
      engine.spriteUpdate(probe, targetTick / 30);
      cx2.clearRect(0, 0, size, size);
      cx2.save();
      cx2.translate(half, half);
      cx2.scale(downscale, downscale);
      engine.renderNode(cx2, probe, true, { r: 1, g: 1, b: 1 }, { r: 0, g: 0, b: 0 }, img);
      cx2.restore();
      const imgData = cx2.getImageData(0, 0, size, size);
      const u32 = new Uint32Array(imgData.data.buffer);
      const len = u32.length;
      for (let k = 0; k < len; k++) {
        if ((u32[k] >>> 24) > 5) {
          const x = k % size;
          const y = (k / size) | 0;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          any = true;
        }
      }
    }
  } finally { engine.setSpeed(savedSpeed); }
  if (!any) return { cx: 0, cy: 0 };
  return { cx: ((minX + maxX) / 2 - half) * upscale, cy: ((minY + maxY) / 2 - half) * upscale };
}

function parseFxElement(node) {
  const def = {
    type: (node.getAttribute("type") || "").toLowerCase(),
    name: node.getAttribute("name") || "",
    applyOn: parseApplyOn(node.getAttribute("applyOn")),
    moment: node.getAttribute("moment") || "impact",
    zOrder: node.getAttribute("zOrder") || "foreground",
    position: node.getAttribute("position") || "center",
    blendmode: node.getAttribute("blendmode") || "normal",
    duration: parseFloat(node.getAttribute("duration")) || 0,
    amplitude: parseFloat(node.getAttribute("amplitude")) || 0,
    frequency: parseFloat(node.getAttribute("frequency")) || 0,
    alpha: parseFloat(node.getAttribute("alpha")) || 1,
    mul: node.getAttribute("mul") || null,
    add: node.getAttribute("add") || null,
    transform: null, colorTransform: null, spawn: null, iteration: null,
  };
  const t = firstChildByName(node, "tranform") || firstChildByName(node, "transform");
  if (t) {
    const g = (n) => (t.getAttribute(n) != null ? parseFloat(t.getAttribute(n)) : null);
    def.transform = {
      scale: g("scale"), scaleMin: g("scaleMin"), scaleMax: g("scaleMax"),
      randomX: t.getAttribute("randomX") === "true",
      randomY: t.getAttribute("randomY") === "true",
      mirrorX: t.getAttribute("mirrorX") === "true",
      mirrorY: t.getAttribute("mirrorY") === "true",
    };
  }
  const ct = firstChildByName(node, "colorTransform");
  if (ct) {
    def.colorTransform = {
      alpha: ct.getAttribute("alpha") != null ? parseFloat(ct.getAttribute("alpha")) : 1,
      mul: ct.getAttribute("mul") || null,
      add: ct.getAttribute("add") || null,
    };
  }
  const sp = firstChildByName(node, "spawn");
  if (sp) {
    def.spawn = {
      number: parseInt(sp.getAttribute("number")) || 1,
      scatterX: parseFloat(sp.getAttribute("scatterX")) || 0,
      scatterY: parseFloat(sp.getAttribute("scatterY")) || 0,
      targetDelay: parseFloat(sp.getAttribute("targetDelay")) || 0,
    };
  }
  const it = firstChildByName(node, "iteration");
  if (it) {
    def.iteration = {
      delay: parseFloat(it.getAttribute("delay")) || 0.02,
      amount: parseInt(it.getAttribute("amount")) || 1,
    };
  }
  return def;
}

function parseFxXml(text) {
  const cleaned = String(text || "").replace(/<\?xml[^?]*\?>/gi, "").trim();
  const wrapped = "<Root>" + cleaned + "</Root>";
  const doc = new DOMParser().parseFromString(wrapped, "application/xml");
  const result = {};
  const attackNodes = doc.getElementsByTagName("AttackFX");
  for (let i = 0; i < attackNodes.length; i++) {
    const a = attackNodes[i];
    const id = (a.getAttribute("attack") || "").trim();
    if (!id) continue;
    const list = [];
    for (let j = 0; j < a.children.length; j++) {
      const fx = a.children[j];
      if (fx.tagName === "FX") list.push(parseFxElement(fx));
    }
    result[id] = list;
  }
  return result;
}

async function loadFxForMutant(mutantValue) {
  if (!mutantValue) return null;
  if (fxCache.has(mutantValue)) return fxCache.get(mutantValue);
  const url = `/data/mutants/${mutantValue}/fx.xml?nocache=${Date.now()}`;
  const promise = retryResource(async signal => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw createHttpError(res, url);
    return parseFxXml(await res.text());
  }, 10000, url).catch(error => {
    console.error(`No se pudo cargar el archivo de efectos ${url}.`, error);
    return {};
  });
  fxCache.set(mutantValue, promise);
  const parsed = await promise;
  fxCache.set(mutantValue, parsed);
  return parsed;
}

function mapAnimValueToAttackKey(animValue) {
  const m = String(animValue || "").match(/^attack(.+)$/i);
  return m ? m[1].toLowerCase() : null;
}

function setCurrentAnimation(animValue, attacks) {
  const key = mapAnimValueToAttackKey(animValue);
  if (key == null) { currentAttacks = null; return; }
  const all = attacks || currentAttacks?.all || null;
  if (!all) { currentAttacks = null; return; }
  currentAttacks = { all, key, list: all[key] || null };
}

function setAttacksTable(table) {
  currentAttacks = table ? { all: table, key: null, list: null } : null;
}

function computeTailEndTick(moments) {
  if (!currentAttacks || !currentAttacks.list || !moments) return 0;
  let maxEnd = 0;
  for (const def of currentAttacks.list) {
    const moment = def.moment || "impact";
    const ticks = moments[moment];
    if (!ticks || !ticks.length) continue;
    const baseDelay = (def.spawn && def.spawn.targetDelay) || 0;
    const maxIdx = def.type === "sprite" ? Math.max(0, currentTargetCount - 1) : 0;
    let durTicks = baseDelay * maxIdx * 30;
    if (def.type === "sprite" && def.name) {
      const repeatCount = def.duration > 0 ? Math.max(1, Math.floor(def.duration)) : 1;
      const cycleSec = window.fxManager.getSpriteCycleDuration(def.name, undefined, true) || 0.4;
      durTicks += repeatCount * cycleSec * 30;
    } else {
      const dur = def.duration > 0 ? def.duration : 0.4;
      durTicks += dur * 30;
    }
    const last = ticks[ticks.length - 1];
    const end = last + durTicks;
    if (end > maxEnd) maxEnd = end;
  }
  return maxEnd;
}

async function loadSpriteFxAsset(name, skin) {
  if (!name) return null;
  const requestedSkin = (skin === undefined) ? currentFxSkin : skin;
  const normalizedSkin = (requestedSkin === undefined || requestedSkin === null)
    ? "" : String(requestedSkin).trim();
  const cacheKey = `${name}|${normalizedSkin}`;
  if (fxSpriteCache.has(cacheKey)) return fxSpriteCache.get(cacheKey);
  const promise = (async () => {
    try {
      const xmlUrl = `/data/fx/${name}.xml?nocache=${Date.now()}`;
      const txt = await retryResource(async signal => {
        const res = await fetch(xmlUrl, { signal });
        if (!res.ok) throw createHttpError(res, xmlUrl);
        return res.text();
      }, 10000, xmlUrl);
      const doc = new DOMParser().parseFromString(txt, "application/xml");
      const spriteEl = doc.querySelector("Sprite");
      if (!spriteEl) throw new Error();
      const bitmap = spriteEl.getAttribute("bitmap") || "";
      const base = bitmap.replace(/\.png$/i, "");
      const availableSkins = new Set();
      for (const c of spriteEl.children) {
        if (c.tagName === "Skin") {
          const t = (c.textContent || "").trim();
          if (t) availableSkins.add(t);
        }
      }
      const useSkin = (normalizedSkin && availableSkins.has(normalizedSkin))
        ? normalizedSkin : "";
      const spriteDir = "/images/sprites/";
      const baseUrl = `${spriteDir}${base}.png`;
      let img;
      if (useSkin) {
        const skinUrl = `${spriteDir}${base}_${useSkin}.png`;
        try {
          img = await loadImageWithRetry(skinUrl, 10000, 3);
        } catch (error) {
          console.warn(`No se pudo cargar el efecto ${name} con skin ${useSkin}; se usará la versión básica.`, error);
          img = await loadImageWithRetry(baseUrl);
        }
      } else {
        img = await loadImageWithRetry(baseUrl);
      }
      const tree = window.xmlParser.parseSpriteElement(spriteEl, 1);
      const center = computeSpriteVisualCenter(tree, img);
      return { img, tree, center, availableSkins };
    } catch (error) {
      console.error(`No se pudo procesar el efecto ${name}.`, error);
      return null;
    }
  })();
  fxSpriteCache.set(cacheKey, promise);
  const asset = await promise;
  fxSpriteCache.set(cacheKey, asset);
  return asset;
}

async function preloadSpriteAssetsForAttack(attackKey) {
  if (!currentAttacks || !currentAttacks.all) return;
  const key = attackKey != null ? attackKey : currentAttacks.key;
  if (key == null) return;
  const list = currentAttacks.all[key];
  if (!list || list.length === 0) return;
  const promises = [];
  for (const def of list) {
    if (def.type === "sprite" && def.name) promises.push(loadSpriteFxAsset(def.name));
  }
  if (promises.length > 0) await Promise.all(promises);
}

async function preloadForCurrentAttack() {
  await preloadSpriteAssetsForAttack(currentAttacks ? currentAttacks.key : null);
}

function createInstance(def) {
  const t = def.type;
  if (t === "flash") return { kind: "flash", def, t: 0, duration: def.duration > 0 ? def.duration : 0.4, color: parseHexColor(def.name) };
  if (t === "fade") return { kind: "fade", def, t: 0, duration: def.duration > 0 ? def.duration : 0.5, color: parseHexColor(def.name), capturedMap: null };
  if (t === "move") return { kind: "shake", def, t: 0, duration: def.duration > 0 ? def.duration : 0.1, amplitude: def.amplitude || 5, frequency: def.frequency || 30 };
  if (t === "color") {
    return {
      kind: "color", def, t: 0,
      duration: def.duration > 0 ? def.duration : 0.2,
      mul: def.mul ? parseHexColor(def.mul) : { r: 1, g: 1, b: 1, a: 1 },
      add: def.add ? parseHexColor(def.add) : { r: 0, g: 0, b: 0, a: 1 },
      capturedMap: null,
    };
  }
  if (t === "sprite") {
    const sp = def.spawn || { number: 1, scatterX: 0, scatterY: 0, targetDelay: 0 };
    const tr = def.transform || {};
    const sMin = tr.scaleMin != null ? tr.scaleMin : (tr.scale != null ? tr.scale : 1);
    const sMax = tr.scaleMax != null ? tr.scaleMax : (tr.scale != null ? tr.scale : sMin);
    const repeatCount = def.duration > 0 ? Math.max(1, Math.floor(def.duration)) : 1;
    const particles = [];
    for (let i = 0; i < sp.number; i++) {
      const scale = sMin + Math.random() * Math.max(0, sMax - sMin);
      const ox = tr.randomX ? (Math.random() - 0.5) * sp.scatterX : 0;
      const oy = tr.randomY ? (Math.random() - 0.5) * sp.scatterY : 0;
      particles.push({ scale, ox, oy, elapsed: 0, delay: 0, started: false, playTime: 0, cycleDuration: 0, cyclesDone: 0, repeatCount, done: false, tree: null });
    }
    return {
      kind: "sprite", def, t: 0, name: def.name, particles,
      position: def.position, blendmode: def.blendmode, zOrder: def.zOrder,
      colorMul: def.colorTransform ? parseHexColor(def.colorTransform.mul) : { r: 1, g: 1, b: 1 },
      colorAdd: def.colorTransform ? parseHexColor(def.colorTransform.add) : { r: 0, g: 0, b: 0 },
      alpha: def.colorTransform ? def.colorTransform.alpha : 1, asset: null,
      mirrorX: tr.mirrorX === true,
      mirrorY: tr.mirrorY === true,
      skin: currentFxSkin,
    };
  }
  return null;
}

function onLabelMoment(moment) {
  if (!currentAttacks || !currentAttacks.list) return;
  for (const def of currentAttacks.list) {
    if ((def.moment || "impact") !== moment) continue;
    const isLight = def.type === "flash" || def.type === "fade" || def.type === "color";
    const isVisual = def.type === "sprite" || def.type === "move";
    if (isLight && !lightsEnabled) continue;
    if (isVisual && !effectsEnabled) continue;
    const isSprite = def.type === "sprite";
    const baseDelay = (def.spawn && def.spawn.targetDelay) || 0;
    const copies = isSprite ? Math.max(1, currentTargetCount) : 1;
    for (let ti = 0; ti < copies; ti++) {
      const inst = createInstance(def);
      if (!inst) continue;
      inst.targetIndex = ti;
      inst.spawnDelay = baseDelay * ti;
      if (inst.kind === "sprite") {
        const skin = inst.skin || "";
        const cacheKey = `${inst.name}|${skin}`;
        const applyAsset = (a) => {
          if (!a) return;
          inst.asset = a;
          const cycleDur = computeTreeDuration(a.tree);
          for (const p of inst.particles) {
            p.tree = cloneTree(a.tree);
            p.cycleDuration = cycleDur;
          }
        };
        const asset = fxSpriteCache.get(cacheKey);
        if (asset && !(asset instanceof Promise)) {
          applyAsset(asset);
        } else {
          loadSpriteFxAsset(inst.name, skin).then(applyAsset);
        }
      } else if (inst.kind === "fade" || inst.kind === "color") {
        for (const f of activeFx) {
          if (f.kind !== "fade" && f.kind !== "color") continue;
          for (const w of ["self", "target", "background"]) {
            if (inst.def.applyOn[w] && f.def.applyOn[w]) { f.superseded = true; break; }
          }
        }
      }
      activeFx.push(inst);
    }
  }
}

function clear() { activeFx = []; resetColorTransforms(); }

function update(dtSeconds) {
  if (activeFx.length === 0) return;
  const survivors = [];
  for (const fx of activeFx) {
    fx.t += dtSeconds;
    if (fx.kind === "sprite") {
      let anyAlive = false;
      const spawnDelay = fx.spawnDelay || 0;
      for (const p of fx.particles) {
        if (p.done) continue;
        if (p.tree == null) {
          p.elapsed += dtSeconds;
          if (p.elapsed > (p.delay || 0) + 3) p.done = true;
          else anyAlive = true;
          continue;
        }
        p.elapsed += dtSeconds;
        if (!p.started) {
          if (p.elapsed <= (p.delay || 0)) { anyAlive = true; continue; }
          p.started = true;
        }
        if (p.elapsed < spawnDelay) { anyAlive = true; continue; }
        p.playTime += dtSeconds;
        window.animationEngine.spriteUpdate(p.tree, dtSeconds);
        if (p.cycleDuration > 0 && p.playTime >= (p.cyclesDone + 1) * p.cycleDuration) {
          p.cyclesDone++;
          if (p.cyclesDone < p.repeatCount) { window.animationEngine.resetNodeState(p.tree); p.tree.loopEnabled = false; }
          else p.done = true;
        }
        if (!p.done) anyAlive = true;
      }
      if (anyAlive) survivors.push(fx);
      continue;
    }
    if (fx.kind === "flash") {
      const p = Math.min(1, fx.t / fx.duration);
      const k = 1 - p;
      for (const which of ["self", "target", "background"]) {
        if (!fx.def.applyOn[which]) continue;
        const st = objectColorTransforms[which];
        st.rAdd = fx.color.r * k; st.gAdd = fx.color.g * k; st.bAdd = fx.color.b * k;
      }
      if (fx.t < fx.duration) survivors.push(fx);
      continue;
    }
    if (fx.kind === "fade") {
      if (!fx.capturedMap) {
        fx.capturedMap = {};
        for (const which of ["self", "target", "background"]) {
          if (!fx.def.applyOn[which]) continue;
          const st = objectColorTransforms[which];
          fx.capturedMap[which] = { rMul: st.rMul, gMul: st.gMul, bMul: st.bMul };
        }
      }
      const p = Math.min(1, fx.t / fx.duration);
      if (!fx.superseded) {
        for (const which of ["self", "target", "background"]) {
          if (!fx.def.applyOn[which]) continue;
          const cap = fx.capturedMap[which];
          const st = objectColorTransforms[which];
          st.rMul = cap.rMul + (fx.color.r - cap.rMul) * p;
          st.gMul = cap.gMul + (fx.color.g - cap.gMul) * p;
          st.bMul = cap.bMul + (fx.color.b - cap.bMul) * p;
        }
      }
      if (fx.t < fx.duration) survivors.push(fx);
      continue;
    }
    if (fx.kind === "color") {
      if (!fx.capturedMap) {
        fx.capturedMap = {};
        for (const which of ["self", "target", "background"]) {
          if (!fx.def.applyOn[which]) continue;
          const st = objectColorTransforms[which];
          fx.capturedMap[which] = { rMul: st.rMul, gMul: st.gMul, bMul: st.bMul, rAdd: st.rAdd, gAdd: st.gAdd, bAdd: st.bAdd };
        }
      }
      const p = Math.min(1, fx.t / fx.duration);
      const tm = fx.mul; const ta = fx.add;
      for (const which of ["self", "target", "background"]) {
        if (!fx.def.applyOn[which]) continue;
        const cap = fx.capturedMap[which];
        const st = objectColorTransforms[which];
        st.rMul = cap.rMul + (tm.r - cap.rMul) * p;
        st.gMul = cap.gMul + (tm.g - cap.gMul) * p;
        st.bMul = cap.bMul + (tm.b - cap.bMul) * p;
        st.rAdd = cap.rAdd + (ta.r - cap.rAdd) * p;
        st.gAdd = cap.gAdd + (ta.g - cap.gAdd) * p;
        st.bAdd = cap.bAdd + (ta.b - cap.bAdd) * p;
      }
      if (fx.t < fx.duration) survivors.push(fx);
      continue;
    }
    if (fx.kind === "shake") {
      if (fx.t < fx.duration) survivors.push(fx);
      continue;
    }
  }
  activeFx = survivors;
}

function advanceTicks(ticks) { if (ticks <= 0) return; update(ticks / 30); }

function applyBlendMode(ctx, mode) {
  if (!mode || mode === "normal") ctx.globalCompositeOperation = "source-over";
  else if (mode === "add") ctx.globalCompositeOperation = "lighter";
  else if (mode === "multiply") ctx.globalCompositeOperation = "multiply";
  else if (mode === "hardlight") ctx.globalCompositeOperation = "hard-light";
  else if (mode === "screen") ctx.globalCompositeOperation = "screen";
  else if (mode === "overlay") ctx.globalCompositeOperation = "overlay";
  else if (mode === "darken") ctx.globalCompositeOperation = "darken";
  else if (mode === "lighten") ctx.globalCompositeOperation = "lighten";
  else if (mode === "difference") ctx.globalCompositeOperation = "difference";
  else if (mode === "exclusion") ctx.globalCompositeOperation = "exclusion";
  else ctx.globalCompositeOperation = "source-over";
}

function getSpritePosition(bounds, position) {
  if (!bounds) return { x: 0, y: 0 };
  if (position === "bottom") return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h };
  if (position === "top") return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h };
  if (position === "dealerimpact") return { x: bounds.x + bounds.w * 0.75, y: bounds.y + bounds.h * 0.6 };
  return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
}

function drawSpriteFx(ctx, fx, positions) {
  if (!fx.asset || !positions) return;
  const applySelf = !!fx.def.applyOn.self;
  const applyTarget = !!fx.def.applyOn.target;
  const applyBg = !!fx.def.applyOn.background;
  if (!applySelf && !applyTarget && !applyBg) return;
  const spawnDelay = fx.spawnDelay || 0;
  const center = fx.asset.center || { cx: 0, cy: 0 };
  const copyIndex = fx.targetIndex !== undefined ? fx.targetIndex : 0;
  const drawOnSelf = applySelf && (copyIndex === 0 || !applyTarget);
  ctx.save();
  applyBlendMode(ctx, fx.blendmode);
  if (drawOnSelf && positions.self) {
    drawSpriteAt(ctx, fx, positions.self, true, false, spawnDelay, center);
  }
  if (applyTarget && positions.target) {
    const currentIdx = positions.target.targetIndex !== undefined
      ? positions.target.targetIndex : 0;
    if (copyIndex === currentIdx) {
      drawSpriteAt(ctx, fx, positions.target, false, false, spawnDelay, center);
    }
  }
  if (applyBg && positions.background) {
    drawSpriteAt(ctx, fx, positions.background, false, true, spawnDelay, center);
  }
  ctx.restore();
}

function drawSpriteAt(ctx, fx, bounds, isSelf, useCenter, spawnDelay, center) {
  const scale = useCenter ? 1 : (bounds.scale != null ? bounds.scale : 1);
  const base = getSpritePosition(bounds, fx.position);
  let sx = isSelf ? -1 : 1;
  if (fx.mirrorX) sx = -sx;
  const sy = fx.mirrorY ? -1 : 1;
  for (const p of fx.particles) {
    if (p.done || !p.tree || !p.started) continue;
    if (p.elapsed < spawnDelay) continue;
    ctx.save();
    ctx.globalAlpha = fx.alpha;
    ctx.translate(base.x + p.ox * sx, base.y + p.oy);
    ctx.scale(sx * p.scale * scale, sy * p.scale * scale);
    if (useCenter) ctx.translate(-center.cx, -center.cy);
    window.animationEngine.renderNode(ctx, p.tree, true, fx.colorMul, fx.colorAdd, fx.asset.img);
    ctx.restore();
  }
}

function render(ctx, positions) {
  if (!effectsEnabled) return;
  if (activeFx.length === 0) return;
  for (const fx of activeFx) {
    if (fx.kind === "sprite") drawSpriteFx(ctx, fx, positions);
  }
}

function isShaking(which) {
  for (const fx of activeFx) {
    if (fx.kind !== "shake") continue;
    if (fx.def.applyOn[which]) return fx;
  }
  return null;
}

function getShakeOffset(which) {
  if (!effectsEnabled) return { x: 0, y: 0 };
  const fx = isShaking(which);
  if (!fx) return { x: 0, y: 0 };
  const progress = fx.t / fx.duration;
  if (progress >= 1) return { x: 0, y: 0 };
  const phase = fx.t * fx.frequency * Math.PI * 2;
  const decay = 1 - progress;
  return { x: Math.sin(phase) * fx.amplitude * decay, y: Math.cos(phase * 1.3) * fx.amplitude * decay };
}

function getObjectTransform(which) {
  if (!lightsEnabled) return { rMul: 1, gMul: 1, bMul: 1, rAdd: 0, gAdd: 0, bAdd: 0 };
  const st = objectColorTransforms[which];
  if (!st) return null;
  return { rMul: st.rMul, gMul: st.gMul, bMul: st.bMul, rAdd: st.rAdd, gAdd: st.gAdd, bAdd: st.bAdd };
}

function getTargetCount() { return currentTargetCount; }
function getFxSkin() { return currentFxSkin; }
function setEffectsEnabled(v) { effectsEnabled = !!v; }
function isEffectsEnabled() { return effectsEnabled; }
function setLightsEnabled(v) { lightsEnabled = !!v; }
function isLightsEnabled() { return lightsEnabled; }
function getCurrentAttacks() { return currentAttacks; }

window.fxManager = {
  loadFxForMutant, setAttacksTable, setCurrentAnimation, onLabelMoment,
  update, advanceTicks, render, clear,
  getShakeOffset, getObjectTransform,
  preloadForCurrentAttack, preloadSpriteAssetsForAttack,
  computeTailEndTick,
  getActiveCount: () => activeFx.length,
  setEffectsEnabled, isEffectsEnabled,
  loadSpriteFxAsset,
  cloneTree,
  setFxSkin, getFxSkin,
  getSpriteCycleDuration,
  setTargetCount, getTargetCount, getCurrentAttacks,
  setLightsEnabled, isLightsEnabled,
};