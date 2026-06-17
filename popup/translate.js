const content = document.getElementById("content");
const langInfo = document.getElementById("lang-info");

async function main() {
    try {
        // Find the active mail tab
        const mailTabs = await messenger.mailTabs.query({ active: true, currentWindow: true });
        if (!mailTabs.length) {
            throw new Error("No active mail tab found.");
        }

        // Get the displayed message from that tab
        const message = await messenger.messageDisplay.getDisplayedMessage(mailTabs[0].id);
        if (!message) {
            throw new Error("No email is currently displayed.");
        }

        // Get full MIME structure and extract text
        const fullMessage = await messenger.messages.getFull(message.id);
        const emailText = extractPlainText(fullMessage);

        if (!emailText || emailText.trim().length < 3) {
            throw new Error("The email body is empty or could not be extracted.");
        }

        // Translate
        const result = await translateText(emailText);

        showResult(result.translatedText, result.sourceLang);

    } catch (err) {
        showError(err.message);
    }
}

function showResult(text, sourceLang) {
    if (sourceLang && sourceLang !== "hu") {
        langInfo.textContent = sourceLang.toUpperCase() + " → HU";
    } else if (sourceLang === "hu") {
        langInfo.textContent = "already Hungarian";
    } else {
        langInfo.textContent = "→ HU";
    }

    const paragraphs = (text || "")
        .split(/\n+/)
        .map(line => line.trim())
        .filter(line => line.length > 0);

    content.innerHTML = paragraphs.length === 0
        ? `<p><em>(Empty translation received.)</em></p>`
        : paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join("");
}

function showError(msg) {
    content.innerHTML = `<div class="error">⚠ ${escapeHtml(msg)}</div>`;
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
    for (const subpart of parts) {
        if (subpart.contentType === "text/plain" && subpart.body) {
            return subpart.body.trim();
        }
    }
    for (const subpart of parts) {
        const text = extractPlainText(subpart);
        if (text) return text;
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

async function translateText(text) {
    const MAX_LENGTH = 4800;
    const truncated = text.length > MAX_LENGTH
        ? text.substring(0, MAX_LENGTH) + "\n\n[...text truncated due to length]"
        : text;

    const params = new URLSearchParams({
        client: "gtx",
        sl: "auto",
        tl: "hu",
        dt: "t",
        q: truncated
    });

    const response = await fetch(
        "https://translate.googleapis.com/translate_a/single?" + params.toString()
    );

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data || !Array.isArray(data[0])) {
        throw new Error("Unexpected response from translation service.");
    }

    const translatedText = data[0]
        .filter(item => item?.[0])
        .map(item => item[0])
        .join("");

    return { translatedText, sourceLang: data[2] ?? "unknown" };
}

function escapeHtml(str) {
    return str
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

main();
