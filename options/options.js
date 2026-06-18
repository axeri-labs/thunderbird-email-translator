"use strict";

const checkbox  = document.getElementById("autoTranslate");
const langSelect = document.getElementById("targetLang");
const status    = document.getElementById("status");

const stored = await messenger.storage.local.get(["autoTranslate", "targetLang"]);
checkbox.checked  = !!stored.autoTranslate;
langSelect.value  = stored.targetLang ?? "hu";

async function save() {
    await messenger.storage.local.set({
        autoTranslate: checkbox.checked,
        targetLang:    langSelect.value
    });
    status.textContent = "Mentve.";
    setTimeout(() => { status.textContent = ""; }, 1500);
}

checkbox.addEventListener("change", save);
langSelect.addEventListener("change", save);
