"use strict";

const consentCheckbox   = document.getElementById("translationConsent");
const settingsFieldset  = document.getElementById("settings-fieldset");
const langSelect        = document.getElementById("targetLang");
const providerSelect    = document.getElementById("translationProvider");
const sourceLangSelect  = document.getElementById("sourceLang");
const myMemoryEmailInput = document.getElementById("myMemoryEmail");
const deeplKeyInput     = document.getElementById("deeplApiKey");
const myMemorySection   = document.getElementById("mymemory-section");
const deeplSection      = document.getElementById("deepl-section");
const checkbox          = document.getElementById("autoTranslate");
const statusEl          = document.getElementById("status");

// ── Localization ──────────────────────────────────────────────────────────────

// getMessage answers with an empty string for anything it cannot resolve. Writing
// that into the page would wipe the English text in the HTML and leave a blank
// settings page, so an empty answer always means "keep what the HTML says".
function t(key) {
    try {
        return messenger.i18n.getMessage(key) || "";
    } catch {
        return "";
    }
}

document.title = t("optionsTitle") || document.title;
for (const el of document.querySelectorAll("[data-i18n]")) {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
}
for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    const msg = t(el.dataset.i18nPlaceholder);
    if (msg) el.placeholder = msg;
}
localizeLanguageNames();

// Both lists hold the same language codes in every locale, so the names come
// from the browser's own language database rather than from 20 translated
// strings per locale. The English names in options.html stay as the fallback.
// zh-CN as a language tag reads as "Chinese (China)", so the script subtag is
// asked for instead: that is what the user actually picks. Where a locale has no
// compound name for it, ICU falls back to a "language, script" phrase ("Chinese,
// Simplified Han") that is too long for a dropdown — there, the plain language
// name is clearer, and the list offers only one Chinese anyway.
function displayName(names, code) {
    if (code !== "zh-CN") {
        const name = names.of(code);
        return name === code ? "" : name;
    }
    const compound = names.of("zh-Hans");
    if (compound && compound !== "zh-Hans" && !compound.includes(",")) return compound;
    const plain = names.of("zh");
    return plain === "zh" ? "" : plain;
}

function localizeLanguageNames() {
    let names;
    try {
        names = new Intl.DisplayNames(messenger.i18n.getUILanguage(), { type: "language" });
    } catch {
        return;
    }
    for (const select of [langSelect, sourceLangSelect]) {
        for (const option of select.options) {
            let name;
            try {
                name = displayName(names, option.value);
            } catch {
                continue;
            }
            if (name) option.textContent = name[0].toLocaleUpperCase() + name.slice(1);
        }
    }
}

const stored = await messenger.storage.local.get([
    "translationConsent", "targetLang", "translationProvider", "sourceLang",
    "myMemoryEmail", "deeplApiKey", "autoTranslate"
]);

consentCheckbox.checked  = !!stored.translationConsent;
langSelect.value         = stored.targetLang          ?? "hu";
providerSelect.value     = stored.translationProvider ?? "google";
sourceLangSelect.value   = stored.sourceLang          ?? "en";
myMemoryEmailInput.value = stored.myMemoryEmail       ?? "";
deeplKeyInput.value      = stored.deeplApiKey         ?? "";
checkbox.checked         = !!stored.autoTranslate;

updateProviderSections();
updateConsentGating();

function updateProviderSections() {
    const v = providerSelect.value;
    myMemorySection.classList.toggle("visible", v === "mymemory");
    deeplSection.classList.toggle("visible", v === "deepl");
}

// Every other setting only matters once the user has explicitly allowed email
// text to be sent for translation — gray them out until then so it's obvious
// nothing happens without that consent.
function updateConsentGating() {
    settingsFieldset.disabled = !consentCheckbox.checked;
}

async function save() {
    await messenger.storage.local.set({
        translationConsent:  consentCheckbox.checked,
        targetLang:          langSelect.value,
        translationProvider: providerSelect.value,
        sourceLang:          sourceLangSelect.value,
        myMemoryEmail:       myMemoryEmailInput.value.trim(),
        deeplApiKey:         deeplKeyInput.value.trim(),
        autoTranslate:       checkbox.checked
    });
    statusEl.textContent = t("saved") || "Saved.";
    setTimeout(() => { statusEl.textContent = ""; }, 1500);
}

consentCheckbox.addEventListener("change", () => { updateConsentGating(); save(); });
providerSelect.addEventListener("change", () => { updateProviderSections(); save(); });
langSelect.addEventListener("change", save);
sourceLangSelect.addEventListener("change", save);
myMemoryEmailInput.addEventListener("change", save);
deeplKeyInput.addEventListener("change", save);
checkbox.addEventListener("change", save);
