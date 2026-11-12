// Content script de Lupa: detecta la palabra bajo el cursor y aplica filtros.
// Fase 3: solo escribe en la consola. La tarjeta llega en la Fase 4.

const HOVER_DELAY = 400; // ms con el cursor quieto
const MIN_LENGTH = 4; // letras mínimas
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

// Idioma de la página: español si el atributo lang empieza por "es", si no inglés
function pageLang() {
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

// ¿El cursor está realmente encima de esa palabra? (el caret salta al más cercano)
function isOverWord(node, start, end, x, y) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return [...range.getClientRects()].some(
    (r) => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1
  );
}

// Palabra bajo el cursor (o null) para unas coordenadas y un elemento
function wordUnderCursor(x, y, target) {
  if (target && target.closest && target.closest(IGNORED)) return null;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return null; // hay texto seleccionado

  const caret = caretAt(x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;
  const found = wordAt(caret.node.textContent, caret.offset);
  if (!found || !isOverWord(caret.node, found.start, found.end, x, y)) return null;
  return found.word;
}

// Cursor quieto durante HOVER_DELAY: buscar la palabra
let timer = null;
let last = { x: 0, y: 0, target: null };

function onHover() {
  const word = wordUnderCursor(last.x, last.y, last.target);
  if (!word) return;
  const reason = discardReason(word);
  if (reason) {
    console.log(`[Lupa] descartada: "${word}" (${reason})`);
    return;
  }
  console.log(`[Lupa] palabra: "${word}" (${pageLang()})`);
}

document.addEventListener("mousemove", (e) => {
  clearTimeout(timer);
  if (e.buttons !== 0) return; // arrastrando (seleccionando texto)
  last = { x: e.clientX, y: e.clientY, target: e.target };
  timer = setTimeout(onHover, HOVER_DELAY);
});

document.addEventListener("mouseleave", () => clearTimeout(timer));

console.log("[Lupa] content script cargado");
