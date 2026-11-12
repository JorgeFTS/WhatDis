// Ajustes de Lupa: se guardan al cambiar cualquier control.
const DEFAULTS = { enabled: true, lang: "auto" };

const enabledEl = document.getElementById("enabled");
const langEl = document.getElementById("lang");

async function load() {
  const { settings } = await chrome.storage.local.get({ settings: DEFAULTS });
  const s = { ...DEFAULTS, ...settings };
  enabledEl.checked = s.enabled;
  langEl.value = s.lang;
}

function save() {
  chrome.storage.local.set({
    settings: { enabled: enabledEl.checked, lang: langEl.value },
  });
}

enabledEl.addEventListener("change", save);
langEl.addEventListener("change", save);
load();
