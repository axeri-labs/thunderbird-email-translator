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
    const cacheKey = `tr_${message.id}`;
    const cached   = await messenger.storage.local.get(cacheKey);
    const translation = cached[cacheKey] ?? await fetchTranslation(message);
    if (!translation) return;

    if (!cached[cacheKey]) {
        await messenger.storage.local.set({ [cacheKey]: translation });
    }

    // Inject split view into the message pane via privileged experiment API
    try {
        const result = await messenger.emailTranslator.injectSplitView(
            translation.text, translation.lang
        );
        if (result.ok) {
            // Split view injected — also show in popup for reference
        }
    } catch (e) {
        console.warn("Email Translator: experiment API not available, using popup fallback.", e.message);
    }

    showResult(translation.text, translation.lang);
}

async function fetchTranslation(message) {
    showLoading();
    try {
        const fullMessage = await messenger.messages.getFull(message.id);
        const emailText   = extractPlainText(fullMessage);
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

function showResult(text, lang) {
    let label;
    if (lang && lang !== "hu")  label = lang.toUpperCase() + " → HU";
    else if (lang === "hu")     label = "already Hungarian";
    else                        label = "→ HU";
    langInfo.textContent = label;

    const paragraphs = (text || "")
        .split(/\n+/)
        .map(l => l.trim())
        .filter(l => l.length > 0);

    content.innerHTML = paragraphs.length === 0
        ? "<p><em>(Empty translation received.)</em></p>"
        : paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join("");
}

function showError(msg) {
    langInfo.textContent = "";
    content.innerHTML = `<div class="error">⚠ ${escapeHtml(msg)}</div>`;
}

// ── Text extraction ───────────────────────────────────────────────────────────

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

// ── Google Translate (unofficial, free) ───────────────────────────────────────

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
