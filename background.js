"use strict";

// ── Gombnyomásra indított fordítás ────────────────────────────────────────────

messenger.messageDisplayAction.onClicked.addListener(async (tab) => {
    const message = await messenger.messageDisplay.getDisplayedMessage(tab.id);
    if (!message) return;
    await run(message);
});

// ── Automatikus fordítás ──────────────────────────────────────────────────────

let autoListener = null;

async function updateAutoTranslate() {
    const { autoTranslate } = await messenger.storage.local.get("autoTranslate");

    if (autoTranslate && !autoListener) {
        autoListener = async (tab, message) => {
            if (message) await run(message);
        };
        messenger.messageDisplay.onMessageDisplayed.addListener(autoListener);
    } else if (!autoTranslate && autoListener) {
        messenger.messageDisplay.onMessageDisplayed.removeListener(autoListener);
        autoListener = null;
    }
}

await updateAutoTranslate();

messenger.storage.onChanged.addListener((changes) => {
    if ("autoTranslate" in changes) updateAutoTranslate();
});

// ── Main flow ─────────────────────────────────────────────────────────────────

async function run(message) {
    // Show loading state in the split view immediately
    try {
        await messenger.emailTranslator.injectSplitView(
            "<p style='color:#777;font-style:italic'>Fordítás folyamatban…</p>",
            ""
        );
    } catch (e) {
        console.warn("Email Translator: could not show loading state.", e.message);
    }

    const { targetLang = "hu" } = await messenger.storage.local.get("targetLang");
    const cacheKey = `tr2_${message.id}_${targetLang}`;
    const cached = await messenger.storage.local.get(cacheKey);
    const translation = cached[cacheKey] ?? await fetchTranslation(message, targetLang);
    if (!translation) return;

    if (!cached[cacheKey]) {
        await messenger.storage.local.set({ [cacheKey]: translation });
    }

    try {
        await messenger.emailTranslator.injectSplitView(
            translation.html ?? "",
            translation.text ?? ""
        );
    } catch (e) {
        console.warn("Email Translator: experiment API not available.", e.message);
    }
}

async function fetchTranslation(message, targetLang) {
    try {
        const fullMessage = await messenger.messages.getFull(message.id);

        const rawHtml = extractHtml(fullMessage);
        if (rawHtml) {
            const bodyHtml = htmlBodyContent(rawHtml);
            if (bodyHtml.trim().length > 10) {
                const translation = await translateHtmlPreservingStructure(bodyHtml, targetLang);
                if (translation) return translation;
            }
        }

        const emailText = extractPlainText(fullMessage);
        if (!emailText || emailText.trim().length < 3) return null;
        return await translateText(emailText, targetLang);
    } catch (err) {
        console.error("Email Translator:", err.message);
        return null;
    }
}

// ── HTML / text extraction ────────────────────────────────────────────────────

function extractHtml(part) {
    if (!part) return "";
    if (part.contentType?.startsWith("text/html") && part.body) {
        return maybeDecodeQP(part.body);
    }
    if (part.parts?.length > 0) {
        for (const sub of part.parts) {
            const h = extractHtml(sub);
            if (h) return h;
        }
    }
    return "";
}

// Quoted-printable dekódolás, ha szükséges (=3D, soft line breaks jelenlétéből detektálva)
function maybeDecodeQP(str) {
    if (!str.includes("=3D") && !/=\r?\n/.test(str)) return str;
    return decodeQP(str);
}

function decodeQP(str) {
    // Soft line break eltávolítása
    str = str.replace(/=\r?\n/g, "");
    // =XX sorozatok bájttá alakítása
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        if (str[i] === "=" && i + 2 < str.length && /[0-9A-Fa-f]{2}/.test(str.slice(i + 1, i + 3))) {
            bytes.push(Number.parseInt(str.slice(i + 1, i + 3), 16));
            i += 2;
        } else {
            bytes.push((str.codePointAt(i) ?? 0) & 0xff);
        }
    }
    try {
        return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
    } catch {
        return str;
    }
}

function htmlBodyContent(html) {
    const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return m ? m[1] : html;
}

function stripHtml(html) {
    return html
        .replaceAll(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replaceAll(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replaceAll(/<br\s*\/?>/gi, "\n")
        .replaceAll(/<\/p>/gi, "\n")
        .replaceAll(/<\/div>/gi, "\n")
        .replaceAll(/<[^>]+>/g, "")
        .replaceAll("&nbsp;", " ")
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'")
        .replaceAll(/\n{3,}/g, "\n\n")
        .trim();
}

function findPlainTextPart(parts) {
    for (const sub of parts) {
        if (sub.contentType?.startsWith("text/plain") && sub.body) return sub.body.trim();
    }
    for (const sub of parts) {
        const t = extractPlainText(sub);
        if (t) return t;
    }
    return "";
}

function extractPlainText(part) {
    if (!part) return "";
    if (part.contentType?.startsWith("text/plain") && part.body) return part.body.trim();
    if (part.parts?.length > 0) return findPlainTextPart(part.parts);
    if (part.contentType?.startsWith("text/html") && part.body) return stripHtml(part.body);
    return "";
}

// ── Structure-preserving HTML translation ─────────────────────────────────────

async function translateHtmlPreservingStructure(originalHtml, targetLang) {
    const parser = new DOMParser();
    const origDoc = parser.parseFromString(originalHtml, "text/html");
    origDoc.querySelectorAll("style, script").forEach(e => e.remove());

    const textNodes = [];
    const walker = origDoc.createTreeWalker(origDoc.body, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
        if (node.nodeValue.trim().length > 0) textNodes.push(node);
    }
    if (textNodes.length === 0) return null;

    const tagged = textNodes
        .map((n, i) => `<span id="t${i}">${escapeHtml(n.nodeValue)}</span>`)
        .join(" ");

    const { html: translatedHtml, lang } = await translateHtml(tagged, targetLang);

    const transDoc = parser.parseFromString(translatedHtml, "text/html");
    for (let i = 0; i < textNodes.length; i++) {
        const span = transDoc.getElementById(`t${i}`);
        if (span) textNodes[i].nodeValue = span.textContent;
    }

    return { html: origDoc.body.innerHTML, lang };
}

// ── Google Translate ──────────────────────────────────────────────────────────

async function translateHtml(html, targetLang) {
    const MAX = 8000;
    const q = html.length > MAX ? html.substring(0, MAX) : html;
    const params = new URLSearchParams({ client: "gtx", sl: "auto", tl: targetLang, dt: "t", q });
    const res = await fetch("https://translate.googleapis.com/translate_a/single?" + params);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    if (!data || !Array.isArray(data[0])) throw new Error("Unexpected response from translation service.");
    return {
        html: data[0].filter(i => i?.[0]).map(i => i[0]).join(""),
        lang: data[2] ?? "unknown"
    };
}

async function translateText(text, targetLang) {
    const MAX = 4800;
    const q = text.length > MAX ? text.substring(0, MAX) + "\n\n[...text truncated]" : text;
    const params = new URLSearchParams({ client: "gtx", sl: "auto", tl: targetLang, dt: "t", q });
    const res = await fetch("https://translate.googleapis.com/translate_a/single?" + params);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    if (!data || !Array.isArray(data[0])) throw new Error("Unexpected response from translation service.");
    return {
        text: data[0].filter(i => i?.[0]).map(i => i[0]).join(""),
        lang: data[2] ?? "unknown"
    };
}

function escapeHtml(str) {
    return str
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
