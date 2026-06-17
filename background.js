"use strict";

messenger.messageDisplayAction.onClicked.addListener(async (tab) => {
    const message = await messenger.messageDisplay.getDisplayedMessage(tab.id);
    if (!message) return;
    await run(message);
});

// ── Main flow ─────────────────────────────────────────────────────────────────

async function run(message) {
    // Show loading state in the split view immediately
    try {
        await messenger.emailTranslator.injectSplitView(
            "<p style='color:#777;font-style:italic'>Fordítás folyamatban…</p>",
            "", null
        );
    } catch (e) {
        console.warn("Email Translator: could not show loading state.", e.message);
    }

    const cacheKey = `tr2_${message.id}`;
    const cached = await messenger.storage.local.get(cacheKey);
    const translation = cached[cacheKey] ?? await fetchTranslation(message);
    if (!translation) return;

    if (!cached[cacheKey]) {
        await messenger.storage.local.set({ [cacheKey]: translation });
    }

    try {
        await messenger.emailTranslator.injectSplitView(
            translation.html ?? "",
            translation.text ?? "",
            translation.lang
        );
    } catch (e) {
        console.warn("Email Translator: experiment API not available.", e.message);
    }
}

async function fetchTranslation(message) {
    try {
        const fullMessage = await messenger.messages.getFull(message.id);

        const rawHtml = extractHtml(fullMessage);
        if (rawHtml) {
            const bodyHtml = htmlBodyContent(rawHtml);
            if (bodyHtml.trim().length > 10) {
                const translation = await translateHtmlPreservingStructure(bodyHtml);
                if (translation) return translation;
            }
        }

        const emailText = extractPlainText(fullMessage);
        if (!emailText || emailText.trim().length < 3) return null;
        return await translateText(emailText);
    } catch (err) {
        console.error("Email Translator:", err.message);
        return null;
    }
}

// ── HTML / text extraction ────────────────────────────────────────────────────

function extractHtml(part) {
    if (!part) return "";
    if (part.contentType === "text/html" && part.body) return part.body;
    if (part.parts?.length > 0) {
        for (const sub of part.parts) {
            const h = extractHtml(sub);
            if (h) return h;
        }
    }
    return "";
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
        if (sub.contentType === "text/plain" && sub.body) return sub.body.trim();
    }
    for (const sub of parts) {
        const t = extractPlainText(sub);
        if (t) return t;
    }
    return "";
}

function extractPlainText(part) {
    if (!part) return "";
    if (part.contentType === "text/plain" && part.body) return part.body.trim();
    if (part.parts?.length > 0) return findPlainTextPart(part.parts);
    if (part.contentType === "text/html" && part.body) return stripHtml(part.body);
    return "";
}

// ── Structure-preserving HTML translation ─────────────────────────────────────

async function translateHtmlPreservingStructure(originalHtml) {
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

    const { html: translatedHtml, lang } = await translateHtml(tagged);

    const transDoc = parser.parseFromString(translatedHtml, "text/html");
    for (let i = 0; i < textNodes.length; i++) {
        const span = transDoc.getElementById(`t${i}`);
        if (span) textNodes[i].nodeValue = span.textContent;
    }

    return { html: origDoc.body.innerHTML, lang };
}

// ── Google Translate ──────────────────────────────────────────────────────────

async function translateHtml(html) {
    const MAX = 8000;
    const q = html.length > MAX ? html.substring(0, MAX) : html;
    const params = new URLSearchParams({ client: "gtx", sl: "auto", tl: "hu", dt: "t", q });
    const res = await fetch("https://translate.googleapis.com/translate_a/single?" + params);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    if (!data || !Array.isArray(data[0])) throw new Error("Unexpected response from translation service.");
    return {
        html: data[0].filter(i => i?.[0]).map(i => i[0]).join(""),
        lang: data[2] ?? "unknown"
    };
}

async function translateText(text) {
    const MAX = 4800;
    const q = text.length > MAX ? text.substring(0, MAX) + "\n\n[...text truncated]" : text;
    const params = new URLSearchParams({ client: "gtx", sl: "auto", tl: "hu", dt: "t", q });
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
