// Content script de WhatDis: detecta la palabra bajo el cursor, la busca en
// Wikipedia (vía background.js) y muestra una tarjeta de vista previa.

const HOVER_DELAY = 400; // ms con el cursor quieto
const HIDE_DELAY = 250; // ms antes de cerrar al alejar el cursor
const MIN_LENGTH = 4; // letras mínimas
const GAP = 6; // px entre la palabra y la tarjeta
const MARGIN = 8; // px mínimos hasta el borde de la ventana
const IGNORED = "input, textarea, select, pre, code, [contenteditable]";

// Quita tildes y pasa a minúsculas para comparar
const normalize = (s) =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const STOPWORDS = new Set(
  (
    // español
    "para como pero porque cuando donde desde hasta entre sobre esta este esto estos estas esos esas " +
    "aquel aquella aquellos aquellas otro otra otros otras todo toda todos todas mucho mucha muchos muchas " +
    "poco poca pocos pocas sino aunque mientras tambien ademas ahora aqui alli bien cada cual cuales cuyo " +
    "cuya quien quienes nada algo alguno alguna algunos algunas ninguno ninguna tiene tienen tengo hace " +
    "hacer hacen siendo sido sera estar estan estoy eran habia hay puede pueden poder debe deben nuestro " +
    "nuestra vuestro vuestra suyo suya ella ellos ellas nosotros nosotras usted ustedes asi muy mas menos " +
    "tanto tanta pues entonces luego antes despues siempre nunca jamas tampoco solo mismo misma mismos " +
    "mismas segun durante contra hacia bajo tras mediante " +
    // inglés
    "that this these those with from have has had will would could should been being were was they them " +
    "their there then than when where which while what who whom whose your yours such some more most " +
    "other into onto over under about after before because also just only very much many each every " +
    "both here does did done doing are but and the for not you all any can our its his her she him how " +
    "why may might must shall again once even still same said like make made"
  )
    .split(" ")
    .map(normalize)
);

// Ajustes (se cambian desde popup.html y se aplican sin recargar la página)
const DEFAULTS = { enabled: true, lang: "auto" };
let settings = { ...DEFAULTS };

try {
  chrome.storage.local
    .get({ settings: DEFAULTS })
    .then((stored) => {
      settings = { ...DEFAULTS, ...stored.settings };
    })
    .catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    settings = { ...DEFAULTS, ...changes.settings.newValue };
    if (!settings.enabled) dismiss();
  });
} catch (err) {
  // extensión recargada: se usan los ajustes por defecto
}

// Idioma de búsqueda: el elegido en los ajustes o, en automático, el de la página
// (español si el atributo lang empieza por "es", si no inglés)
function pageLang() {
  if (settings.lang === "es" || settings.lang === "en") return settings.lang;
  const lang = (document.documentElement.lang || "").toLowerCase();
  return lang.startsWith("es") ? "es" : "en";
}

// ¿Es un carácter de palabra? (letras, números y marcas de tilde)
const isWordChar = (ch) => !!ch && /[\p{L}\p{N}\p{M}]/u.test(ch);

// Devuelve la palabra que contiene la posición `offset` del texto, o null
function wordAt(text, offset) {
  let i = offset;
  if (!isWordChar(text[i])) i = offset - 1; // el cursor puede caer justo al final
  if (i < 0 || !isWordChar(text[i])) return null;
  let start = i;
  let end = i + 1;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  return { word: text.slice(start, end), start, end };
}

// Devuelve el motivo para descartar la palabra, o null si es válida
function discardReason(word) {
  if (/\p{N}/u.test(word)) return "tiene números";
  if ([...word].length < MIN_LENGTH) return "muy corta";
  if (STOPWORDS.has(normalize(word))) return "conector/artículo/verbo común";
  return null;
}

// Nodo de texto y posición bajo el cursor
function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    return pos && { node: pos.offsetNode, offset: pos.offset };
  }
  if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    return range && { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

// ¿El punto está dentro del rectángulo? (con 1 px de margen)
const inRect = (r, x, y) =>
  x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1;

// Rectángulo de la palabra que contiene el cursor, o null si el cursor no está encima
function rectOverWord(node, start, end, x, y) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return [...range.getClientRects()].find((r) => inRect(r, x, y)) || null;
}

// Palabra y rectángulo bajo el cursor ({word, rect}) o null
function wordUnderCursor(x, y, target) {
  if (target && target.closest && target.closest(IGNORED)) return null;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return null; // hay texto seleccionado

  const caret = caretAt(x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;
  const found = wordAt(caret.node.textContent, caret.offset);
  if (!found) return null;
  const rect = rectOverWord(caret.node, found.start, found.end, x, y);
  return rect ? { word: found.word, rect } : null;
}

// ---------- Tarjeta (Shadow DOM cerrado) ----------

const CARD_CSS = `
  .card {
    box-sizing: border-box;
    width: 320px;
    max-width: calc(100vw - 16px);
    background: #fff;
    color: #202122;
    border: 1px solid #a2a9b1;
    border-radius: 3px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.25);
    font: 14px/1.5 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    overflow: hidden;
  }
  .img { display: block; width: 100%; height: 150px; object-fit: cover; object-position: center top; background: #eaecf0; }
  .body { padding: 12px 16px 4px; }
  .title { margin: 0 0 6px; font: normal 1.35em/1.25 "Linux Libertine", Georgia, Times, serif; }
  .extract { margin: 0; display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
  .intro { margin: 0 0 4px; color: #54595d; }
  .opts { display: flex; flex-direction: column; }
  .opt { display: block; padding: 5px 0; border-top: 1px solid #eaecf0; }
  .opt:hover { text-decoration: none; background: #f8f9fa; }
  .opt-title { display: block; }
  .opt-desc { display: block; font-size: 12px; color: #54595d; }
  .foot { display: flex; justify-content: space-between; align-items: center; padding: 8px 16px 12px; font-size: 12px; color: #54595d; }
  .right { display: flex; align-items: center; gap: 8px; }
  a { color: #36c; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .gear { padding: 0; border: 0; background: none; font: inherit; font-size: 15px; line-height: 1; color: #54595d; cursor: pointer; }
  .gear:hover { color: #202122; }
`;

let host = null; // contenedor en la página
let cardEl = null; // tarjeta dentro del shadow root

// Crea el contenedor la primera vez que hace falta
function ensureHost() {
  if (host) return;
  host = document.createElement("div");
  host.style.cssText =
    "all: initial; position: fixed; z-index: 2147483647; display: none;";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CARD_CSS;
  cardEl = document.createElement("div");
  cardEl.className = "card";
  shadow.append(style, cardEl);
  document.documentElement.append(host);
}

// Crea un elemento con clase y texto (siempre con textContent, nunca innerHTML)
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function link(href, text) {
  const a = el("a", "", text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

// Dibuja la tarjeta con los datos y la coloca junto a la palabra
function showCard(data, wordRect) {
  ensureHost();

  const parts = [];
  if (data.thumbnail) {
    const img = el("img", "img");
    img.src = data.thumbnail;
    img.alt = "";
    parts.push(img);
  }
  const body = el("div", "body");
  body.append(el("h2", "title", data.title));
  if (data.options) {
    // Desambiguación: lista de significados enlazados
    body.append(el("p", "intro", data.lang === "es" ? "Puede referirse a:" : "May refer to:"));
    const list = el("div", "opts");
    for (const o of data.options) {
      const a = link(o.url, "");
      a.className = "opt";
      a.append(el("span", "opt-title", o.title));
      if (o.description) a.append(el("span", "opt-desc", o.description));
      list.append(a);
    }
    body.append(list);
  } else {
    body.append(el("p", "extract", data.extract));
  }
  const gear = el("button", "gear", "⚙");
  gear.title = "Ajustes de WhatDis";
  gear.addEventListener("click", openSettings);
  const right = el("div", "right");
  right.append(link("https://creativecommons.org/licenses/by-sa/4.0/", "CC BY-SA"), gear);
  const foot = el("div", "foot");
  foot.append(link(data.url, "Wikipedia ↗"), right);
  parts.push(body, foot);
  cardEl.replaceChildren(...parts);

  // Medir fuera de la vista y luego colocar dentro de la ventana
  host.style.visibility = "hidden";
  host.style.display = "block";
  const { width, height } = host.getBoundingClientRect();
  const viewW = document.documentElement.clientWidth;
  const viewH = window.innerHeight;

  const left = Math.min(Math.max(MARGIN, wordRect.left), viewW - width - MARGIN);
  let top = wordRect.bottom + GAP; // debajo de la palabra
  if (top + height > viewH - MARGIN) top = wordRect.top - height - GAP; // si no cabe, encima
  top = Math.max(MARGIN, top);

  host.style.left = Math.max(0, left) + "px";
  host.style.top = top + "px";
  host.style.visibility = "visible";
}

const isShown = () => !!host && host.style.display !== "none";

// ---------- Eventos ----------

let hoverTimer = null;
let hideTimer = null;
let requestId = 0; // para ignorar respuestas viejas
let current = null; // {word, rect} de la última palabra consultada
let last = { x: 0, y: 0, target: null };

// Solo oculta la tarjeta (no toca una búsqueda pendiente de otra palabra)
function hideCard() {
  clearTimeout(hideTimer);
  hideTimer = null;
  current = null;
  if (host) host.style.display = "none";
}

// Cierre pedido por el usuario: oculta y cancela todo lo pendiente
function dismiss() {
  clearTimeout(hoverTimer);
  requestId++;
  hideCard();
}

// Pide la búsqueda al service worker. Devuelve null ante cualquier fallo
async function lookupWord(word, lang) {
  try {
    return await chrome.runtime.sendMessage({ type: "lookup", word, lang });
  } catch (err) {
    return null; // extensión recargada o service worker no disponible
  }
}

// Pide al service worker que abra los ajustes (los content scripts no pueden)
function openSettings() {
  try {
    chrome.runtime.sendMessage({ type: "openOptions" }).catch(() => {});
  } catch (err) {
    // extensión recargada
  }
  dismiss();
}

const sameRect = (a, b) =>
  a.left === b.left && a.top === b.top && a.width === b.width;

// Cursor quieto durante HOVER_DELAY: buscar la palabra y mostrar la tarjeta
async function onHover() {
  if (!settings.enabled) return;
  const hit = wordUnderCursor(last.x, last.y, last.target);
  if (!hit || discardReason(hit.word)) return;
  if (current && current.word === hit.word && sameRect(current.rect, hit.rect)) return;

  const id = ++requestId;
  current = hit;
  const data = await lookupWord(hit.word, pageLang());
  if (id !== requestId || !data) return; // llegó tarde o no hay resultado
  if (!inRect(hit.rect, last.x, last.y)) return; // el cursor ya se fue
  showCard(data, hit.rect);
}

document.addEventListener("mousemove", (e) => {
  clearTimeout(hoverTimer);
  if (e.buttons !== 0) { // arrastrando (seleccionando texto)
    dismiss();
    return;
  }
  last = { x: e.clientX, y: e.clientY, target: e.target };

  // Cursor sobre la tarjeta o sobre la palabra: mantenerla abierta
  const overCard = host && e.target === host;
  if (overCard || (current && inRect(current.rect, e.clientX, e.clientY))) {
    clearTimeout(hideTimer);
    hideTimer = null;
    if (overCard) return;
  } else if (isShown() && !hideTimer) {
    hideTimer = setTimeout(hideCard, HIDE_DELAY); // se alejó
  }
  hoverTimer = setTimeout(onHover, HOVER_DELAY);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") dismiss();
});
document.addEventListener("mousedown", (e) => {
  if (!host || e.target !== host) dismiss();
});
document.addEventListener("mouseleave", dismiss);
window.addEventListener("scroll", () => (isShown() || current) && dismiss(), true);
