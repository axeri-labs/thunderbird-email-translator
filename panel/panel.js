const content = document.getElementById("content");
const langInfo = document.getElementById("lang-info");

// ── Entry point ───────────────────────────────────────────────────────────────

const mailTabs = await messenger.mailTabs.query({ active: true, currentWindow: true });
if (mailTabs.length) {
    const message = await messenger.messageDisplay.getDisplayedMessage(mailTabs[0].id);
    if (message) {
        await run(mailTabs[0].id, message);
    } else {
        showError("No email is currently displayed.");
    }
} else {
    showError("No active mail tab found.");
}

// ── Main flow ─────────────────────────────────────────────────────────────────

async function run(tabId, message) {
    const cacheKey = `tr2_${message.id}`;
    const cached   = await messenger.storage.local.get(cacheKey);
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

    showResult(translation);
}

async function fetchTranslation(message) {
    showLoading();
    try {
        const fullMessage = await messenger.messages.getFull(message.id);

        // Structure-preserving HTML translation (keeps images, tables, styles)
        const rawHtml = extractHtml(fullMessage);
        if (rawHtml) {
            const bodyHtml = htmlBodyContent(rawHtml);
            if (bodyHtml.trim().length > 10) {
                const translation = await translateHtmlPreservingStructure(bodyHtml);
                if (translation) return translation;
            }
        }

        // Fall back to plain text
        const emailText = extractPlainText(fullMessage);
        if (!emailText || emailText.trim().length < 3) {
            throw new Error("The email body is empty or could not be extracted.");
        }
        return await translateText(emailText);
    } catch (err) {
        showError(err.message);
        return null;
    }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function showLoading() {
    langInfo.textContent = "";
    content.innerHTML = `
        <div class="loading">
            <span class="spinner"></span>
            Translating…
        </div>`;
}

function showResult(translation) {
    const { text, html, lang } = translation;
    if (lang && lang !== "hu")  langInfo.textContent = lang.toUpperCase() + " → HU";
    else if (lang === "hu")     langInfo.textContent = "already Hungarian";
    else                        langInfo.textContent = "→ HU";

    if (html) {
        content.innerHTML = html;
    } else {
        const paras = (text || "").split(/\n+/).map(l => l.trim()).filter(Boolean);
        content.innerHTML = paras.length
            ? paras.map(p => `<p>${escapeHtml(p)}</p>`).join("")
            : "<p><em>(Empty translation received.)</em></p>";
    }
}

function showError(msg) {
    langInfo.textContent = "";
    content.innerHTML = `<div class="error">⚠ ${escapeHtml(msg)}</div>`;
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
//
// Strategy:
//   1. Parse original HTML, remove style/script (not images or layout)
//   2. Walk all text nodes; wrap each in <span id="tN">text</span>
//   3. Send only the compact tagged string to Google Translate
//      (GT preserves span tags and id attributes)
//   4. Parse the translated result; extract text per span ID
//   5. Replace text nodes in the ORIGINAL DOM with the translations
//   6. Return the modified original HTML — structure/images unchanged

async function translateHtmlPreservingStructure(originalHtml) {
    const parser = new DOMParser();
    const origDoc = parser.parseFromString(originalHtml, "text/html");
    origDoc.querySelectorAll("style, script").forEach(e => e.remove());

    // Collect non-whitespace text nodes
    const textNodes = [];
    const walker = origDoc.createTreeWalker(origDoc.body, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
        if (node.nodeValue.trim().length > 0) textNodes.push(node);
    }
    if (textNodes.length === 0) return null;

    // Build compact tagged HTML: <span id="t0">Hello</span> <span id="t1">World</span>
    const tagged = textNodes
        .map((n, i) => `<span id="t${i}">${escapeHtml(n.nodeValue)}</span>`)
        .join(" ");

    // Translate — GT preserves <span id="..."> wrappers
    const { html: translatedHtml, lang } = await translateHtml(tagged);

    // Parse translated result and apply text back to original DOM nodes
    const transDoc = parser.parseFromString(translatedHtml, "text/html");
    for (let i = 0; i < textNodes.length; i++) {
        const span = transDoc.getElementById(`t${i}`);
        if (span) textNodes[i].nodeValue = span.textContent;
    }

    return { html: origDoc.body.innerHTML, lang };
}

// ── Google Translate (unofficial, free) ───────────────────────────────────────

async function translateHtml(html) {
    const MAX = 8000;
    const q   = html.length > MAX ? html.substring(0, MAX) : html;
    const params = new URLSearchParams({ client: "gtx", sl: "auto", tl: "hu", dt: "t", q });
    const res  = await fetch("https://translate.googleapis.com/translate_a/single?" + params);
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
    const q   = text.length > MAX ? text.substring(0, MAX) + "\n\n[...text truncated]" : text;
    const params = new URLSearchParams({ client: "gtx", sl: "auto", tl: "hu", dt: "t", q });
    const res  = await fetch("https://translate.googleapis.com/translate_a/single?" + params);
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
