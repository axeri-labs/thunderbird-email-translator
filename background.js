"use strict";

// Register the message display content script into every email display page
await messenger.messageDisplayScripts.register({
    js: [{ file: "content/inject.js" }]
});

// ── Button click ──────────────────────────────────────────────────────────────

messenger.messageDisplayAction.onClicked.addListener(async (tab) => {
    const message = await messenger.messageDisplay.getDisplayedMessage(tab.id);
    if (!message) return;
    await run(message, tab.id);
});

// ── Auto-translate ────────────────────────────────────────────────────────────

let autoListener = null;

async function updateAutoTranslate() {
    const { autoTranslate } = await messenger.storage.local.get("autoTranslate");
    if (autoTranslate && !autoListener) {
        autoListener = async (tab, message) => {
            if (message) await run(message, tab.id);
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

// Per-tab generation counter — incremented on every new translation request.
// Any in-flight run() for an older generation silently discards its results.
const tabGen = new Map();

async function sendToTab(tabId, payload) {
    try {
        await messenger.tabs.sendMessage(tabId, payload);
    } catch (e) {
        console.warn("Email Translator: tab message failed.", e.message);
    }
}

async function run(message, tabId) {
    const gen = (tabGen.get(tabId) ?? 0) + 1;
    tabGen.set(tabId, gen);

    const send = async (payload) => {
        if (tabGen.get(tabId) !== gen) return;
        await sendToTab(tabId, payload);
    };

    await send({ action: "injectSplitView", html: "", text: "", banner: "⏳ Translating…" });

    try {
        const { targetLang = "hu" } = await messenger.storage.local.get("targetLang");
        const cacheKey = `tr2_${message.id}_${targetLang}`;
        const cached = await messenger.storage.local.get(cacheKey);

        if (cached[cacheKey]) {
            await send({
                action: "injectSplitView",
                html: cached[cacheKey].html ?? "",
                text: cached[cacheKey].text ?? "",
                banner: ""
            });
            return;
        }

        const fullMessage = await messenger.messages.getFull(message.id);

        const rawHtml = extractHtml(fullMessage);
        if (rawHtml) {
            await send({
                action: "injectSplitView",
                html: htmlBodyContent(rawHtml),
                text: "",
                banner: "⏳ Translating…"
            });
        }

        const translation = await fetchTranslation(fullMessage, targetLang);
        if (tabGen.get(tabId) !== gen) return;

        if (!translation) {
            await send({
                action: "injectSplitView",
                html: "<p style='color:#c00'>No translatable content found in this email.</p>",
                text: "", banner: ""
            });
            return;
        }

        await messenger.storage.local.set({ [cacheKey]: translation });
        await send({
            action: "injectSplitView",
            html: translation.html ?? "",
            text: translation.text ?? "",
            banner: ""
        });
    } catch (err) {
        console.error("Email Translator:", err.message);
        const is429 = err.message.includes("429");
        const html = is429
            ? `<p style='color:#c00;font-weight:600'>MyMemory rate limit reached.</p>
               <p style='font-size:13px;color:#444;margin-top:8px;line-height:1.6'>
                 MyMemory limits requests per IP address — changing email does not help.<br><br>
                 <strong>Option 1:</strong> Wait a few minutes and try again.<br>
                 <strong>Option 2:</strong> Switch to <strong>Google Translate</strong> in Settings — free, no limits.<br>
                 <strong>Option 3:</strong> Switch to <strong>DeepL</strong> in Settings (free API key, 500,000 characters/month).
               </p>`
            : `<p style='color:#c00'>Translation failed: ${escapeHtml(err.message)}</p>`;
        await send({ action: "injectSplitView", html, text: "", banner: "" });
    }
}

// ── Translation providers ─────────────────────────────────────────────────────

// fullMessage is already fetched in run() and passed here to avoid double fetch
async function fetchTranslation(fullMessage, targetLang) {
    const { translationProvider = "google", deeplApiKey = "" } =
        await messenger.storage.local.get(["translationProvider", "deeplApiKey"]);

    if (translationProvider === "deepl" && deeplApiKey) {
        return fetchTranslationDeepl(fullMessage, targetLang, deeplApiKey);
    }
    if (translationProvider === "mymemory") {
        return fetchTranslationMyMemory(fullMessage, targetLang);
    }
    return fetchTranslationGoogle(fullMessage, targetLang);
}

// Google Translate (unofficial) — no key, auto-detects source language
const GT_MAX_BATCH = 2000;
const GT_MAX_BATCHES = 4;

async function fetchTranslationGoogle(fullMessage, targetLang) {
    const rawHtml = extractHtml(fullMessage);
    if (rawHtml) {
        const bodyHtml = htmlBodyContent(rawHtml);
        if (bodyHtml.trim().length > 10) {
            const result = await translateHtmlPreservingStructureGoogle(bodyHtml, targetLang);
            if (result) return result;
        }
    }
    const text = extractPlainText(fullMessage);
    if (!text || text.trim().length < 3) return null;
    const MAX = 5000;
    const truncated = text.length > MAX;
    const translated = await googleTranslate(truncated ? text.substring(0, MAX) : text, targetLang);
    const suffix = truncated ? "\n\n⚠ Translation truncated. Switch to DeepL for longer emails." : "";
    return { text: translated + suffix };
}

async function translateHtmlPreservingStructureGoogle(originalHtml, targetLang) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(originalHtml, "text/html");
    doc.querySelectorAll("style, script").forEach(e => e.remove());
    const textNodes = collectTextNodes(doc.body);
    if (textNodes.length === 0) return null;
    const batches = buildBatches(textNodes, GT_MAX_BATCH);
    for (let i = 0; i < Math.min(batches.length, GT_MAX_BATCHES); i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 300));
        const translated = await googleTranslate(batches[i].text, targetLang);
        const parts = translated.split(MM_SEP_RE);
        for (let j = 0; j < batches[i].nodes.length; j++) {
            batches[i].nodes[j].nodeValue = parts[j] ?? (j === 0 ? translated : "");
        }
    }
    return { html: doc.body.innerHTML };
}

const GOOGLE_LANG = { "zh-CN": "zh-CN", "zh-TW": "zh-TW", "pt": "pt", "en": "en" };

async function googleTranslate(text, targetLang) {
    const tl = GOOGLE_LANG[targetLang] ?? targetLang.split("-")[0];
    const url = "https://translate.googleapis.com/translate_a/single" +
        `?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`);
    const data = await res.json();
    return data[0].map(item => item[0] ?? "").join("");
}

// MyMemory — free, no API key required
// Preserves HTML structure: clones original HTML, translates only text nodes in-place
async function fetchTranslationMyMemory(fullMessage, targetLang) {
    const { sourceLang = "en", myMemoryEmail = "" } =
        await messenger.storage.local.get(["sourceLang", "myMemoryEmail"]);

    const rawHtml = extractHtml(fullMessage);
    if (rawHtml) {
        const bodyHtml = htmlBodyContent(rawHtml);
        if (bodyHtml.trim().length > 10) {
            const result = await translateHtmlPreservingStructureMM(bodyHtml, sourceLang, targetLang, myMemoryEmail);
            if (result) return result;
        }
    }

    // Fallback for plain-text emails
    const text = extractPlainText(fullMessage);
    if (!text || text.trim().length < 3) return null;

    const MAX = 3000;
    const truncated = text.length > MAX;
    const translated = await myMemoryTranslate(
        truncated ? text.substring(0, MAX) : text,
        sourceLang, targetLang, myMemoryEmail
    );
    const suffix = truncated
        ? "\n\n⚠ Translation truncated. For longer emails, switch to DeepL in settings."
        : "";
    return { text: translated + suffix };
}

const MM_SEP = " |||| ";
const MM_SEP_RE = /\s*\|\|\|\|\s*/;
const MM_MAX_BATCH = 480;
const MM_MAX_BATCHES = 5;
const MM_BATCH_DELAY = 1200;

async function translateHtmlPreservingStructureMM(originalHtml, sourceLang, targetLang, email = "") {
    const parser = new DOMParser();
    const doc = parser.parseFromString(originalHtml, "text/html");
    doc.querySelectorAll("style, script").forEach(e => e.remove());

    const textNodes = collectTextNodes(doc.body);
    if (textNodes.length === 0) return null;

    const batches = buildBatches(textNodes);
    for (let i = 0; i < Math.min(batches.length, MM_MAX_BATCHES); i++) {
        if (i > 0) await new Promise(r => setTimeout(r, MM_BATCH_DELAY));
        await translateAndApplyBatch(batches[i], sourceLang, targetLang, email);
    }

    return { html: doc.body.innerHTML };
}

function collectTextNodes(root) {
    const nodes = [];
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
        if (node.nodeValue.trim().length > 0) nodes.push(node);
    }
    return nodes;
}

function buildBatches(textNodes, maxBatch = MM_MAX_BATCH) {
    const batches = [];
    let cur = { nodes: [], text: "" };
    for (const n of textNodes) {
        const t = n.nodeValue.trim().substring(0, maxBatch);
        const wouldExceed = cur.text && cur.text.length + MM_SEP.length + t.length > maxBatch;
        if (wouldExceed) {
            batches.push(cur);
            cur = { nodes: [], text: "" };
        }
        cur.nodes.push(n);
        cur.text = cur.text ? cur.text + MM_SEP + t : t;
    }
    if (cur.nodes.length > 0) batches.push(cur);
    return batches;
}

async function translateAndApplyBatch(batch, sourceLang, targetLang, email = "") {
    const paramObj = { q: batch.text, langpair: `${sourceLang}|${targetLang}` };
    if (email) paramObj.de = email;
    const params = new URLSearchParams(paramObj);
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2500 * attempt));
        res = await fetch("https://api.mymemory.translated.net/get?" + params);
        if (res.status !== 429) break;
    }
    if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
    const data = await res.json();
    if (data.responseStatus !== 200) throw new Error(`MyMemory: ${data.responseDetails ?? "unknown error"}`);

    const parts = data.responseData.translatedText.split(MM_SEP_RE);
    for (let i = 0; i < batch.nodes.length; i++) {
        batch.nodes[i].nodeValue = parts[i] ?? (i === 0 ? data.responseData.translatedText : "");
    }
}

// DeepL — higher quality, preserves HTML structure; requires free API key
async function fetchTranslationDeepl(fullMessage, targetLang, apiKey) {
    const rawHtml = extractHtml(fullMessage);
    if (rawHtml) {
        const bodyHtml = htmlBodyContent(rawHtml);
        if (bodyHtml.trim().length > 10) {
            try {
                const MAX = 30000;
                const truncated = bodyHtml.length > MAX;
                const translatedHtml = await deeplTranslate(
                    truncated ? bodyHtml.substring(0, MAX) : bodyHtml,
                    targetLang, "html", apiKey
                );
                const suffix = truncated
                    ? "<p style='color:#999;font-size:12px;border-top:1px solid #eee;padding-top:8px;'>⚠ Translation truncated — email exceeds 30,000 characters.</p>"
                    : "";
                return { html: translatedHtml + suffix };
            } catch (err) {
                console.warn("DeepL HTML translation failed, falling back to plain text:", err.message);
            }
        }
    }

    const text = extractPlainText(fullMessage);
    if (!text || text.trim().length < 3) return null;

    const MAX = 30000;
    const truncated = text.length > MAX;
    const translated = await deeplTranslate(
        truncated ? text.substring(0, MAX) : text,
        targetLang, "text", apiKey
    );
    const suffix = truncated
        ? "\n\n⚠ Translation truncated — email exceeds 30,000 characters."
        : "";
    return { text: translated + suffix };
}

// ── API calls ─────────────────────────────────────────────────────────────────

// Split text into ≤490-char chunks at word boundaries
function chunkText(text, maxLen = 490) {
    if (text.length <= maxLen) return [text];
    const chunks = [];
    let remaining = text.trim();
    while (remaining.length > maxLen) {
        let cut = maxLen;
        while (cut > 0 && !/\s/.test(remaining[cut])) cut--;
        if (cut === 0) cut = maxLen;
        chunks.push(remaining.substring(0, cut).trim());
        remaining = remaining.substring(cut).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
}

async function myMemoryTranslate(text, sourceLang, targetLang, email = "") {
    const chunks = chunkText(text);
    const results = [];
    for (const chunk of chunks) {
        const paramObj = { q: chunk, langpair: `${sourceLang}|${targetLang}` };
        if (email) paramObj.de = email;
        const params = new URLSearchParams(paramObj);
        const res = await fetch("https://api.mymemory.translated.net/get?" + params);
        if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
        const data = await res.json();
        if (data.responseStatus !== 200) {
            throw new Error(`MyMemory: ${data.responseDetails ?? "unknown error"}`);
        }
        results.push(data.responseData.translatedText);
    }
    return results.join(" ");
}

// DeepL uses different lang codes for a few languages
const DEEPL_LANG = { "en": "EN-US", "pt": "PT-BR", "zh-CN": "ZH" };

async function deeplTranslate(text, targetLang, format, apiKey) {
    const tl = DEEPL_LANG[targetLang] ?? targetLang.split("-")[0].toUpperCase();
    const body = { text: [text], target_lang: tl };
    if (format === "html") body.tag_handling = "html";

    const res = await fetch("https://api-free.deepl.com/v2/translate", {
        method: "POST",
        headers: {
            "Authorization": `DeepL-Auth-Key ${apiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(`DeepL HTTP ${res.status}: ${msg}`);
    }
    const data = await res.json();
    return data.translations?.[0]?.text ?? "";
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

function maybeDecodeQP(str) {
    if (!str.includes("=3D") && !/=\r?\n/.test(str)) return str;
    return decodeQP(str);
}

function decodeQP(str) {
    str = str.replace(/=\r?\n/g, "");
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

function escapeHtml(str) {
    return str
        .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
