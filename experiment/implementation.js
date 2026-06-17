"use strict";

/* global ExtensionCommon, ChromeUtils, Services */

this.emailTranslator = class extends ExtensionCommon.ExtensionAPI {
    getAPI() {
        return {
            emailTranslator: {
                async injectSplitView(html, text, lang) {
                    try {
                        const win = findMailWindow();
                        if (!win) return { ok: false, error: "No mail:3pane window found" };

                        // Find the deepest document that contains email content
                        const { doc, info } = findEmailDocument(win);
                        if (!doc) return { ok: false, error: `No email document found. ${info}` };

                        const body = doc.body || doc.querySelector("body");
                        if (!body) return { ok: false, error: `Document exists but no body. ${info}` };

                        applySplitView(doc, body, html, text, lang);
                        return { ok: true, info };
                    } catch (e) {
                        return { ok: false, error: `Exception: ${e.message} @ ${e.fileName}:${e.lineNumber}` };
                    }
                }
            }
        };
    }
};

// ── Window helper ─────────────────────────────────────────────────────────────

function findMailWindow() {
    return Services.wm.getMostRecentWindow("mail:3pane") ||
           Services.wm.getMostRecentWindow("mail:messageWindow");
}

// ── Find the email document ───────────────────────────────────────────────────

// Recursively search nested <browser> elements for the imap:// email document.
// TB 115 Supernova renders: 3pane → about:message browser → email browser (imap://)
function findEmailDocument(win) {
    const result = findImapDocIn(win.document, 0);
    if (result) return result;
    return { doc: null, info: "imap:// document not found at any nesting level" };
}

function findImapDocIn(doc, depth) {
    if (depth > 6) return null;
    const browsers = Array.from(doc.querySelectorAll("browser"));

    // First pass: direct match — browser whose currentURI is imap://
    for (const b of browsers) {
        if (b.currentURI?.scheme !== "imap") continue;
        const d = getDoc(b);
        if (!d) continue;
        const body = d.body || d.querySelector("body");
        if (body) return { doc: d, info: `depth=${depth} id=${b.id} uri=${b.currentURI.spec}` };
    }

    // Second pass: recurse into each child browser document
    for (const b of browsers) {
        const d = getDoc(b);
        if (!d) continue;
        const found = findImapDocIn(d, depth + 1);
        if (found) return found;
    }

    return null;
}

function getDoc(browser) {
    return browser.contentDocument ?? browser.contentWindow?.document ?? null;
}

// ── Split view DOM manipulation ───────────────────────────────────────────────

function applySplitView(doc, body, html, text, lang) {
    // If already split, just update the right panel content
    const translationContent = html || buildParagraphs(text);

    if (doc.getElementById("et-right")) {
        const bodyEl = doc.getElementById("et-body");
        if (bodyEl) bodyEl.innerHTML = translationContent;
        return;
    }

    // Capture original body appearance before we overwrite its styles
    const view = doc.defaultView || doc.ownerGlobal;
    const cs = view ? view.getComputedStyle(body) : null;
    const origBg = cs ? cs.backgroundColor : null;

    injectStyles(doc, origBg);

    // Move existing body children to the left column
    const left = doc.createElement("div");
    left.id = "et-left";
    while (body.firstChild) left.appendChild(body.firstChild);

    const divider = doc.createElement("div");
    divider.id = "et-divider";

    const right = doc.createElement("div");
    right.id = "et-right";
    right.innerHTML = `<div id="et-body">${translationContent}</div>`;

    body.appendChild(left);
    body.appendChild(divider);
    body.appendChild(right);

    body.style.cssText =
        "display:flex !important; flex-direction:row !important; " +
        "margin:0 !important; padding:0 !important; " +
        "height:100vh !important; overflow:hidden !important; box-sizing:border-box !important;";

    setupResizer(doc, divider, left, right);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildParagraphs(text) {
    const lines = (text || "")
        .split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);
    return lines.length ? lines.map(p => `<p>${esc(p)}</p>`).join("") : "<p><em>(empty)</em></p>";
}

function langLabel(lang) {
    if (!lang || lang === "unknown") return "→ HU";
    if (lang === "hu") return "already HU";
    return lang.toUpperCase() + " → HU";
}

function esc(s) {
    return s.replaceAll("&","&amp;").replaceAll("<","&lt;")
            .replaceAll(">","&gt;").replaceAll('"',"&quot;");
}

function injectStyles(doc, origBg) {
    if (doc.getElementById("et-styles")) return;
    const style = doc.createElement("style");
    style.id = "et-styles";

    const isTransparent = !origBg || origBg === "rgba(0, 0, 0, 0)" || origBg === "transparent";
    const bg = isTransparent ? "" : `background:${origBg};`;

    style.textContent = `
        #et-left  { flex:1 1 50%; overflow-y:auto; height:100%; min-width:0; }
        #et-divider { flex:0 0 4px; background:#000000; cursor:col-resize; height:100%; }
        #et-right { flex:1 1 50%; display:flex; flex-direction:column; height:100%;
                    min-width:0; ${bg} }
        #et-body { flex:1; overflow-y:auto; }
        #et-body > p { margin:0 0 9px; padding:14px 16px 0; }
        #et-body > p:last-child { margin:0; padding-bottom:14px; }
    `;
    (doc.head || doc.documentElement).appendChild(style);
}

function setupResizer(doc, divider, left, right) {
    let dragging = false, startX = 0, startL = 0, startR = 0;
    divider.addEventListener("mousedown", e => {
        dragging = true; startX = e.clientX;
        startL = left.getBoundingClientRect().width;
        startR = right.getBoundingClientRect().width;
        doc.body.style.userSelect = "none";
        e.preventDefault();
    });
    doc.addEventListener("mousemove", e => {
        if (!dragging) return;
        const dx = e.clientX - startX, total = startL + startR;
        const newL = Math.min(Math.max(startL + dx, 100), total - 100);
        left.style.flex  = `0 0 ${newL}px`;
        right.style.flex = `0 0 ${total - newL}px`;
    });
    doc.addEventListener("mouseup", () => { dragging = false; doc.body.style.userSelect = ""; });
}
