// Service worker de Lupa: busca en Wikipedia y guarda los resultados en caché.

const API_USER_AGENT = "Lupa/0.1 (https://github.com/JorgeFTS/WhatDis)";
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

// Pide el resumen de un título. Devuelve el objeto de la tarjeta o null
async function fetchSummary(title, lang) {
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
  // Solo artículos normales (no desambiguaciones ni páginas especiales)
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

// Busca la palabra y, si no existe, sus variantes
async function lookup(word, lang) {
  for (const candidate of variants(word, lang)) {
    const result = await fetchSummary(candidate, lang);
    if (result) return result;
  }
  return null;
}

// El content script pide búsquedas con un mensaje
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "lookup") {
    lookup(msg.word, msg.lang).then(sendResponse);
    return true; // respuesta asíncrona
  }
});

console.log("[Lupa] service worker activo");
