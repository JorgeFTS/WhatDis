// Service worker de WhatDis: busca en Wikipedia y guarda los resultados en caché.

const API_USER_AGENT = "WhatDis/0.1 (https://github.com/JorgeFTS/WhatDis)";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 días

// Variantes de una palabra: la original y versiones sin plural
function variants(word, lang) {
  const list = [word];
  const w = word.toLowerCase();
  if (lang === "es") {
    if (w.endsWith("ces")) list.push(w.slice(0, -3) + "z"); // luces → luz
    if (w.endsWith("es")) list.push(w.slice(0, -2)); // ciudades → ciudad
    if (w.endsWith("s")) list.push(w.slice(0, -1)); // perros → perro
  } else {
    if (w.endsWith("ies")) list.push(w.slice(0, -3) + "y"); // cities → city
    if (w.endsWith("es")) list.push(w.slice(0, -2)); // boxes → box
    if (w.endsWith("s")) list.push(w.slice(0, -1)); // dogs → dog
  }
  // Sin repetidos y sin variantes demasiado cortas
  return [...new Set(list)].filter((v) => v.length >= 3);
}

// Lee de la caché. Devuelve undefined si no hay dato vigente
async function cacheGet(key) {
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key];
  if (entry && Date.now() - entry.time < CACHE_TTL) return entry;
  return undefined;
}

async function cacheSet(key, data) {
  await chrome.storage.local.set({ [key]: { time: Date.now(), data } });
}

// Significados de una página de desambiguación: títulos tipo "Docker (software)".
// Devuelve una lista (puede estar vacía) o undefined si falla la red
async function fetchOptions(title, lang) {
  const url = `https://${lang}.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(title)}&limit=15`;
  let res;
  try {
    res = await fetch(url, { headers: { "Api-User-Agent": API_USER_AGENT } });
  } catch (err) {
    return undefined;
  }
  if (!res.ok) return undefined;

  const json = await res.json();
  const prefix = title.toLowerCase() + " (";
  return json.pages
    .filter((p) => p.title.toLowerCase().startsWith(prefix))
    .slice(0, 5)
    .map((p) => ({
      title: p.title,
      description: p.description || "",
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.key)}`,
    }));
}

// Pide el resumen de un título. Devuelve el objeto de la tarjeta o null
// allowList=false: las desambiguaciones se descartan (para las frases)
async function fetchSummary(title, lang, allowList = true) {
  const key = `${lang}:${title.toLowerCase()}`;
  const cached = await cacheGet(key);
  if (cached) return cached.data; // incluye los null (no encontrado)

  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  let res;
  try {
    res = await fetch(url, { headers: { "Api-User-Agent": API_USER_AGENT } });
  } catch (err) {
    return null; // error de red: no se guarda en caché
  }

  if (res.status === 404) {
    await cacheSet(key, null); // caché negativa
    return null;
  }
  if (!res.ok) return null; // otro error: no se guarda en caché

  const json = await res.json();
  // Desambiguación: la tarjeta muestra una lista de significados
  if (json.type === "disambiguation") {
    if (!allowList) {
      await cacheSet(key, null);
      return null;
    }
    const options = await fetchOptions(json.title, lang);
    if (!options) return null; // error de red: no se guarda en caché
    const data = options.length
      ? { title: json.title, options, url: json.content_urls.desktop.page, lang }
      : null;
    await cacheSet(key, data);
    return data;
  }

  // Solo artículos normales (no páginas especiales)
  if (json.type !== "standard" || !json.extract) {
    await cacheSet(key, null);
    return null;
  }

  const data = {
    title: json.title,
    extract: json.extract,
    thumbnail: json.thumbnail ? json.thumbnail.source : null,
    url: json.content_urls.desktop.page,
    lang,
  };
  await cacheSet(key, data);
  return data;
}

// Busca primero las frases ("Google Cloud", de la más larga a la más corta; en paralelo)
// y luego la palabra y, si no existe, sus variantes
async function lookup(word, lang, phrases = []) {
  const results = await Promise.all(phrases.map((p) => fetchSummary(p, lang, false)));
  const i = results.findIndex(Boolean);
  if (i !== -1) return { ...results[i], phrase: phrases[i] };

  if (!word) return null;
  for (const candidate of variants(word, lang)) {
    const result = await fetchSummary(candidate, lang);
    if (result) return result;
  }
  return null;
}

// El content script pide búsquedas con un mensaje
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "openOptions") {
    chrome.runtime.openOptionsPage(); // el engranaje de la tarjeta
    sendResponse(null);
    return;
  }
  if (msg && msg.type === "lookup") {
    const phrases = Array.isArray(msg.phrases)
      ? msg.phrases.filter((p) => typeof p === "string").slice(0, 5)
      : [];
    lookup(msg.word, msg.lang, phrases)
      .then(sendResponse)
      .catch(() => sendResponse(null));
    return true; // respuesta asíncrona
  }
});

console.log("[WhatDis] service worker activo");
