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
    statusEl.textContent = "Saved.";
    setTimeout(() => { statusEl.textContent = ""; }, 1500);
}

consentCheckbox.addEventListener("change", () => { updateConsentGating(); save(); });
providerSelect.addEventListener("change", () => { updateProviderSections(); save(); });
langSelect.addEventListener("change", save);
sourceLangSelect.addEventListener("change", save);
myMemoryEmailInput.addEventListener("change", save);
deeplKeyInput.addEventListener("change", save);
checkbox.addEventListener("change", save);
