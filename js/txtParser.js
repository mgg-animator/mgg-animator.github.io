let langsCache = {};
let localisationCache = {};
let localisationPromises = {};

function sanitizeText(text) {
  if (text == null) return "";
  return String(text)
    .replace(/\\r/g, "")
    .replace(/\\t/g, "")
    .replace(/\\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function getFromMap(map, key) {
  if (!map || key == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(map, key)) return map[key];
  const lower = String(key).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(map, lower)) return map[lower];
  for (const k of Object.keys(map)) {
    if (k.toLowerCase() === lower) return map[k];
  }
  return undefined;
}

async function retryResource(load, timeoutMs = 10000, label = "recurso") {
  let warned = false;
  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await load(controller.signal);
    } catch (error) {
      if (error && error.retryable === false) throw error;
      if (!warned) {
        console.warn(`No se pudo cargar ${label}; se reintentará.`, error);
        warned = true;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    } finally {
      clearTimeout(timeout);
    }
  }
}

function createHttpError(response, url) {
  const error = new Error(`HTTP ${response.status}: ${url}`);
  error.retryable = response.status >= 500 || response.status === 408 || response.status === 429;
  return error;
}

async function fetchTextFile(url, timeoutMs = 10000) {
  const requestUrl = url + (url.indexOf("?") === -1 ? "?nocache=" + Date.now() : "");
  return retryResource(async signal => {
    const res = await fetch(requestUrl, { signal });
    if (!res.ok) throw createHttpError(res, url);
    return res.text();
  }, timeoutMs, url);
}

let langsPromise = null;
async function loadLangsFile() {
  if (Object.keys(langsCache).length) return langsCache;
  if (langsPromise) return langsPromise;
  langsPromise = (async () => {
    try {
      const text = await fetchTextFile("/data/langs.txt");
      langsCache = parseSimpleTXT(text);
    } catch (_) { langsCache = {}; }
    langsPromise = null;
    return langsCache;
  })();
  return langsPromise;
}

async function loadLocalisation(lang) {
  const key = lang || currentLang;
  if (localisationCache[key] && Object.keys(localisationCache[key]).length > 0) {
    return localisationCache[key];
  }
  if (localisationPromises[key]) return localisationPromises[key];
  localisationPromises[key] = (async () => {
    const url = `/data/gameconfig/localisation_${key}.txt`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const text = await fetchTextFile(url, 10000);
        const parsed = parseSimpleTXT(text);
        if (parsed && Object.keys(parsed).length > 0) {
          localisationCache[key] = parsed;
          return parsed;
        }
      } catch (_) {}
      if (attempt < 2) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
    return {};
  })();
  try {
    return await localisationPromises[key];
  } finally {
    localisationPromises[key] = null;
  }
}

async function parseCustomTXT(path, lang = currentLang) {
  const [langsMap, localisationMap, text] = await Promise.all([
    loadLangsFile(),
    loadLocalisation(lang),
    fetchTextFile(path)
  ]);
  const lines = text.split(/\r?\n/);
  const result = [];
  for (const line of lines) {
    if (!line || line.startsWith("//")) continue;
    const [type, nameRaw = "", imageRaw = "", valueRaw = ""] = line.split(";");
    let name = nameRaw.trim();
    if (name.startsWith("[") && name.endsWith("]")) {
      const key = name.slice(1, -1);
      name = getFromMap(localisationMap, key) || key;
    }
    else if (name.startsWith("#")) {
      const key = name.slice(1);
      name = getFromMap(langsMap, `${key}-${lang}`)
          || getFromMap(langsMap, key)
          || key;
    }
    name = sanitizeText(name);
    let image = imageRaw.trim();
    if (image.startsWith("$$")) {
      image = "https://s-ak.kobojo.com/mutants/assets/" + image.slice(2);
    } else if (image.startsWith("&&")) {
      image = image.slice(2);
    }
    let value = valueRaw.trim();
    if (value.includes("§")) {
      value = value.replace("§", "*");
    }
    result.push({
      type: type.trim(),
      name,
      image: image || null,
      value: value || null
    });
  }
  return result;
}

function parseSimpleTXT(text) {
  const map = {};
  text.split(/\r?\n/).forEach(line => {
    if (!line || line.startsWith("//")) return;
    const [key, val] = line.split(";");
    if (key && val) map[key.trim()] = sanitizeText(val);
  });
  return map;
}
