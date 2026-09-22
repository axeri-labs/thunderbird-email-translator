"use strict";

// Register the message display content script into every email display page
await messenger.messageDisplayScripts.register({
    js: [{ file: "content/vendor/purify.min.js" }, { file: "content/inject.js" }]
});

// ── Button click ──────────────────────────────────────────────────────────────

messenger.messageDisplayAction.onClicked.addListener(async (tab) => {
    const message = await messenger.messageDisplay.getDisplayedMessage(tab.id);
    if (!message) return;
    await run(message, tab.id);
});

// ── Auto-translate setting (cached to avoid async delay in the listener) ──────

let cachedAutoTranslate = false;
const AUTO_TRANSLATE_DEBOUNCE_MS = 350;

async function syncAutoTranslate() {
    const { autoTranslate } = await messenger.storage.local.get("autoTranslate");
    cachedAutoTranslate = !!autoTranslate;
}

await syncAutoTranslate();

messenger.storage.onChanged.addListener((changes) => {
    if ("autoTranslate" in changes) cachedAutoTranslate = !!changes.autoTranslate.newValue;
});

// ── One-off cache migration ────────────────────────────────────────────────────

// Old cache entries were keyed by the ephemeral internal message.id (tr2_<numericId>_<lang>),
// which could silently resolve to the wrong message after a restart or folder compaction —
// see run() for why headerMessageId is used now. New keys are never purely numeric (a
// Message-ID header always contains non-digit characters), so this can't touch fresh entries
// and is safe to run on every startup.
async function purgeStaleTranslationCache() {
    const all = await messenger.storage.local.get(null);
    const staleKeys = Object.keys(all).filter(k => /^tr2_\d+_/.test(k));
    if (staleKeys.length > 0) await messenger.storage.local.remove(staleKeys);
}

await purgeStaleTranslationCache();

// ── Email display change ──────────────────────────────────────────────────────

// Always fires when the user switches to a different email.
// cachedAutoTranslate is read synchronously so the gen bump / debounce below
// happens without delay, preventing out-of-order execution when emails are
// switched quickly.
messenger.messageDisplay.onMessageDisplayed.addListener(async (tab, message) => {
    if (!message) return;
    if (cachedAutoTranslate) {
        // Debounce: flicking through several emails quickly would otherwise
        // fire one translation API call per email. Wait for the user to
        // settle on one — if a newer switch bumps the gen during the wait,
        // skip translating this one entirely (no wasted API call).
        const gen = bumpTabGen(tab.id);
        await new Promise(r => setTimeout(r, AUTO_TRANSLATE_DEBOUNCE_MS));
        if (tabGen.get(tab.id) !== gen) return;
        await run(message, tab.id, gen, false);
    } else {
        // Bump the generation counter even though no new run() starts here —
        // otherwise a manual translation still in flight for the previous
        // email would pass its stale gen check and reappear over this one.
        const gen = bumpTabGen(tab.id);
        await sendToTab(tab.id, { action: "closeSplitView" }, () => tabGen.get(tab.id) === gen);
    }
});

// ── Main flow ─────────────────────────────────────────────────────────────────

// Per-tab generation counter — incremented on every new translation request.
// Any in-flight run() for an older generation silently discards its results.
const tabGen = new Map();

function bumpTabGen(tabId) {
    const gen = (tabGen.get(tabId) ?? 0) + 1;
    tabGen.set(tabId, gen);
    return gen;
}

// Retries on failure — the content script may not have finished loading yet
// (e.g. right after a fast email switch), so the first send can find no
// listener on the other end. stillValid() stops the retries once the user
// has moved on to a different email.
const SEND_RETRY_DELAYS_MS = [100, 250, 500, 1000];

async function sendToTab(tabId, payload, stillValid = () => true, attempt = 0) {
    try {
        await messenger.tabs.sendMessage(tabId, payload);
    } catch (e) {
        if (attempt < SEND_RETRY_DELAYS_MS.length && stillValid()) {
            await new Promise(r => setTimeout(r, SEND_RETRY_DELAYS_MS[attempt]));
            if (stillValid()) return sendToTab(tabId, payload, stillValid, attempt + 1);
        }
        console.warn("Email Translator: tab message failed.", e.message);
    }
}

// gen: pass an already-bumped generation (e.g. from the debounce above) to
// avoid bumping twice for the same request; omit for immediate calls (button
// click) where no debounce precedes run().
// manual: true for a direct button click, false for auto-translate. Controls
// what happens when consent hasn't been granted (see below).
async function run(message, tabId, gen = bumpTabGen(tabId), manual = true) {
    const stillValid = () => tabGen.get(tabId) === gen;

    const send = async (payload) => {
        if (!stillValid()) return;
        await sendToTab(tabId, payload, stillValid);
    };

    // Nothing may be sent to a translation service until the user has explicitly
    // opted in on the Settings page — see options.html. Auto-translate stays
    // silent when consent is missing (it fires on every opened email, so a
    // message here would nag constantly); a manual click gets one explanation.
    const { translationConsent = false } = await messenger.storage.local.get("translationConsent");
    if (!translationConsent) {
        if (!manual) return;
        await send({
            action: "injectSplitView",
            html: `<p style='color:#444;font-weight:600'>Email translation is turned off.</p>
                   <p style='font-size:13px;color:#666;margin-top:8px;line-height:1.6'>
                     Translating sends the email text to an external service (Google Translate,
                     MyMemory, or DeepL). Open <strong>Settings</strong> and enable
                     “Allow sending email text for translation” to use this feature.
                   </p>`,
            text: "",
            banner: ""
        });
        return;
    }

    // Resolved up front so both the banner and the error panel can name the
    // service that actually runs — neither may point at a provider the user
    // didn't pick.
    const providerCfg = await resolveProvider();
    const busyBanner = `⏳ Translating… (${PROVIDER_LABEL[providerCfg.provider]})`;

    await send({ action: "injectSplitView", html: "", text: "", banner: busyBanner });

    try {
        const { targetLang = "hu" } = await messenger.storage.local.get("targetLang");
        // message.id is only unique for the current session — Thunderbird can
        // reassign it to a completely different message after a restart or a
        // folder compaction. headerMessageId (the RFC Message-ID header) stays
        // stable across those, so it's the only safe key for a persistent cache.
        const cacheKey = `tr2_${message.headerMessageId ?? message.id}_${targetLang}`;
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
                banner: busyBanner
            });
        }

        const translation = await fetchTranslation(fullMessage, targetLang, providerCfg);
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
        await send({
            action: "injectSplitView",
            html: errorPanelHtml(providerCfg.provider, err),
            text: "",
            banner: ""
        });
    }
}

// ── Error reporting ───────────────────────────────────────────────────────────

const PROVIDER_LABEL = {
    google: "Google Translate",
    mymemory: "MyMemory",
    deepl: "DeepL"
};

// Errors that can explain themselves: which provider produced them, and what
// kind of failure it was ("quota" | "auth" | "config" | "http").
class TranslationError extends Error {
    constructor(provider, kind, detail = "") {
        super(`${PROVIDER_LABEL[provider] ?? provider}: ${detail || kind}`);
        this.provider = provider;
        this.kind = kind;
        this.detail = detail;
    }
}

function errorKind(err) {
    return err instanceof TranslationError ? err.kind : "local";
}

const P_ERR = "<p style='color:#c00;font-weight:600'>";
const P_BODY = "<p style='font-size:13px;color:#444;margin-top:8px;line-height:1.6'>";

// Every panel names the provider the user actually selected, and never asks for
// an account the selected provider doesn't need.
function errorPanelHtml(provider, err) {
    const label = PROVIDER_LABEL[provider] ?? provider;
    const kind = errorKind(err);

    if (kind === "config" && provider === "deepl") {
        return `${P_ERR}DeepL is selected, but no API key is saved.</p>
                ${P_BODY}Enter your DeepL API key in <strong>Settings</strong>, or switch the engine to
                <strong>Google Translate</strong> — it needs no key and no account.</p>`;
    }
    if (kind === "auth" && provider === "deepl") {
        return `${P_ERR}DeepL rejected the API key.</p>
                ${P_BODY}Check the key in <strong>Settings</strong> (free keys end in <code>:fx</code>), or switch the
                engine to <strong>Google Translate</strong> — it needs no key and no account.</p>`;
    }
    if (kind === "quota" && provider === "mymemory") {
        return `${P_ERR}MyMemory's free quota for this connection is used up.</p>
                ${P_BODY}This is a limit of the MyMemory service, applied per IP address.<br><br>
                <strong>Option 1:</strong> Switch the engine to <strong>Google Translate</strong> in Settings —
                free, no key, no account.<br>
                <strong>Option 2:</strong> Wait a few minutes and try again.<br>
                <strong>Option 3:</strong> Enter an e-mail address in the MyMemory section of Settings — optional,
                it raises MyMemory's own daily quota.</p>`;
    }
    if (kind === "quota") {
        return `${P_ERR}${escapeHtml(label)} is rate-limiting this connection.</p>
                ${P_BODY}${escapeHtml(label)} temporarily refused further requests from this IP address.
                No account or login is involved — waiting a few minutes and trying again usually clears it.<br><br>
                You can also switch the engine in <strong>Settings</strong>.</p>`;
    }
    // "local" means the failure never reached a translation service (reading the
    // message, injecting the panel): naming a provider there would blame the
    // wrong thing.
    const blame = kind === "local" ? "" : ` (${escapeHtml(label)})`;
    return `${P_ERR}Translation failed${blame}.</p>
            ${P_BODY}${escapeHtml(err.message)}</p>`;
}

// ── Translation providers ─────────────────────────────────────────────────────

async function resolveProvider() {
    const { translationProvider = "google", deeplApiKey = "" } =
        await messenger.storage.local.get(["translationProvider", "deeplApiKey"]);
    const provider = PROVIDER_LABEL[translationProvider] ? translationProvider : "google";
    return { provider, deeplApiKey };
}

// fullMessage is already fetched in run() and passed here to avoid double fetch
async function fetchTranslation(fullMessage, targetLang, { provider, deeplApiKey }) {
    if (provider === "deepl") {
        // A missing key used to fall through to Google: the email then went to a
        // service the user hadn't chosen. Fail visibly instead.
        if (!deeplApiKey) throw new TranslationError("deepl", "config");
        return fetchTranslationDeepl(fullMessage, targetLang, deeplApiKey);
    }
    if (provider === "mymemory") {
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

// The public endpoint rate-limits per IP and recovers quickly, so a couple of
// spaced retries turn most 429s into a successful translation.
const GT_RETRY_DELAYS_MS = [1500, 4000];

async function googleTranslate(text, targetLang) {
    const tl = GOOGLE_LANG[targetLang] ?? targetLang.split("-")[0];
    const url = "https://translate.googleapis.com/translate_a/single" +
        `?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;

    let res;
    for (let attempt = 0; ; attempt++) {
        res = await fetch(url);
        if (res.status !== 429 || attempt >= GT_RETRY_DELAYS_MS.length) break;
        await new Promise(r => setTimeout(r, GT_RETRY_DELAYS_MS[attempt]));
    }
    if (!res.ok) {
        throw new TranslationError("google", res.status === 429 ? "quota" : "http", `HTTP ${res.status}`);
    }
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
    throwIfMyMemoryFailed(res);
    const data = await res.json();
    throwIfMyMemoryRejected(data);

    const parts = data.responseData.translatedText.split(MM_SEP_RE);
    for (let i = 0; i < batch.nodes.length; i++) {
        batch.nodes[i].nodeValue = parts[i] ?? (i === 0 ? data.responseData.translatedText : "");
    }
}

function throwIfMyMemoryFailed(res) {
    if (res.ok) return;
    throw new TranslationError("mymemory", res.status === 429 ? "quota" : "http", `HTTP ${res.status}`);
}

// MyMemory answers HTTP 200 with a warning in responseDetails when the free
// daily quota is spent; that text is what tells the user to log in. Classify it
// so the panel can explain it as a MyMemory limit instead of passing it through
// raw — and it can only ever reach a user who selected MyMemory.
const MM_QUOTA_RE = /MYMEMORY WARNING|QUOTA|ALL AVAILABLE FREE TRANSLATIONS|LOGIN/i;

function throwIfMyMemoryRejected(data) {
    if (data.responseStatus === 200) return;
    const detail = String(data.responseDetails ?? "unknown error");
    throw new TranslationError("mymemory", MM_QUOTA_RE.test(detail) ? "quota" : "http", detail);
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
                // A rejected key or a spent quota fails the same way on the second
                // call — report it instead of spending another request on it.
                if (err instanceof TranslationError && (err.kind === "auth" || err.kind === "quota")) throw err;
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
        throwIfMyMemoryFailed(res);
        const data = await res.json();
        throwIfMyMemoryRejected(data);
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
        const kind = res.status === 403 || res.status === 401 ? "auth"
            : res.status === 429 || res.status === 456 ? "quota"
            : "http";
        throw new TranslationError("deepl", kind, `HTTP ${res.status}${msg ? `: ${msg}` : ""}`);
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
