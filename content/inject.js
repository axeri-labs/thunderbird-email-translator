"use strict";

// Guard against double-injection if the background restarts
if (!globalThis.__emailTranslatorLoaded) {
    globalThis.__emailTranslatorLoaded = true;

    browser.runtime.onMessage.addListener((message) => {
        switch (message.action) {
            case "injectSplitView": injectSplitView(message.html, message.text, message.banner ?? ""); break;
            case "closeSplitView":  closeSplitView();  break;
        }
    });
}

// ── Split view ────────────────────────────────────────────────────────────────

function injectSplitView(html, text, banner = "") {
    const body = document.body;
    if (!body) return;

    const content = html || buildParagraphs(text);

    // Already split — update content and banner only
    if (document.getElementById("et-right")) {
        const bodyEl = document.getElementById("et-body");
        // An empty payload is a banner-only update (the "translating…" step of a
        // re-translation) — leave what is on screen instead of blanking it.
        if (bodyEl && (html || text)) bodyEl.innerHTML = sanitize(content);
        const bannerEl = document.getElementById("et-banner");
        if (bannerEl) {
            bannerEl.textContent = banner;
            bannerEl.style.display = banner ? "flex" : "none";
        }
        setBusy(document.getElementById("et-retry"), banner);
        return;
    }

    const origBg = globalThis.getComputedStyle(body).backgroundColor;
    injectStyles(origBg);

    const left = document.createElement("div");
    left.id = "et-left";
    while (body.firstChild) left.appendChild(body.firstChild);

    const divider = document.createElement("div");
    divider.id = "et-divider";

    const retryBtn = document.createElement("button");
    retryBtn.id = "et-retry";
    retryBtn.title = "Translate again";
    retryBtn.appendChild(circularArrowIcon());

    const closeBtn = document.createElement("button");
    closeBtn.id = "et-close";
    closeBtn.title = "Close translation";
    closeBtn.textContent = "✕";

    const bannerEl = document.createElement("div");
    bannerEl.id = "et-banner";
    bannerEl.textContent = banner;
    bannerEl.style.display = banner ? "flex" : "none";

    const bodyEl = document.createElement("div");
    bodyEl.id = "et-body";
    bodyEl.innerHTML = sanitize(content); // renders translated email HTML — sanitized, untrusted source

    const right = document.createElement("div");
    right.id = "et-right";
    right.appendChild(retryBtn);
    right.appendChild(closeBtn);
    right.appendChild(bannerEl);
    right.appendChild(bodyEl);

    body.appendChild(left);
    body.appendChild(divider);
    body.appendChild(right);
    body.style.cssText =
        "display:flex !important; flex-direction:row !important; " +
        "margin:0 !important; padding:0 !important; " +
        "height:100vh !important; overflow:hidden !important; box-sizing:border-box !important;";

    closeBtn.addEventListener("click", closeSplitView);
    retryBtn.addEventListener("click", requestRetranslate);
    setBusy(retryBtn, banner);
    setupResizer(divider, left, right);
}

// Drawn rather than typed: a "↻" character depends on a font that has it, and
// the email being displayed controls the fonts in this document.
const SVG_NS = "http://www.w3.org/2000/svg";

function circularArrowIcon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "17");
    svg.setAttribute("height", "17");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");

    // Open circle with an arrowhead at its end — legible at 17px, unlike a
    // filled glyph of the same size.
    for (const d of ["M20.49 15a9 9 0 1 1-2.12-9.36L23 10", "M23 4v6h-6"]) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        svg.appendChild(path);
    }
    return svg;
}

// Ask the background to translate this email again, ignoring the cached result —
// for when a translation came back wrong, truncated, or from the wrong engine,
// or after changing a setting.
function requestRetranslate() {
    browser.runtime.sendMessage({ action: "retranslate" });
}

// A banner is only shown while a translation is running, so it doubles as the
// "busy" signal for the button.
function setBusy(btn, banner) {
    if (btn) btn.disabled = !!banner;
}

function closeSplitView() {
    const left    = document.getElementById("et-left");
    const divider = document.getElementById("et-divider");
    const right   = document.getElementById("et-right");
    if (!left) return;

    const body = document.body;
    while (left.firstChild) body.insertBefore(left.firstChild, left);
    left.remove();
    divider?.remove();
    right?.remove();
    document.getElementById("et-styles")?.remove();
    body.style.cssText = "";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// content can be translated HTML sourced from the email body — untrusted, may still
// carry event-handler attributes or javascript: URLs after translation.
function sanitize(html) {
    return globalThis.DOMPurify ? globalThis.DOMPurify.sanitize(html) : "";
}

function buildParagraphs(text) {
    const lines = (text || "").split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);
    return lines.length
        ? lines.map(p => `<p>${esc(p)}</p>`).join("")
        : "<p><em>(empty)</em></p>";
}

function esc(s) {
    return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function injectStyles(origBg) {
    if (document.getElementById("et-styles")) return;
    const style = document.createElement("style");
    style.id = "et-styles";
    const transparent = !origBg || origBg === "rgba(0, 0, 0, 0)" || origBg === "transparent";
    const bg = transparent ? "" : `background:${origBg};`;
    style.textContent = `
        #et-left    { flex:1 1 50%; overflow-y:auto; height:100%; min-width:0; }
        #et-divider { flex:0 0 4px; background:#888; cursor:col-resize; height:100%; }
        #et-right   { flex:1 1 50%; position:relative; display:flex; flex-direction:column; height:100%; min-width:0; ${bg} }
        #et-banner  { position:absolute; top:0; left:0; right:0; z-index:9;
                      background:#fffbe6; border-bottom:1px solid #e8c840;
                      padding:14px 18px; font-size:14px; color:#7a5c00; }
        #et-close, #et-retry
                    { position:absolute; top:10px; z-index:10;
                      width:28px; height:28px; border-radius:50%;
                      background:rgba(0,0,0,.15); border:none; cursor:pointer;
                      font-size:14px; color:#333; line-height:1;
                      display:flex; align-items:center; justify-content:center; }
        #et-close   { right:10px; }
        #et-retry   { right:44px; }
        #et-close:hover, #et-retry:hover:not(:disabled) { background:rgba(0,0,0,.3); color:#000; }
        #et-retry:disabled { opacity:.4; cursor:default; }
        #et-body    { flex:1; overflow:auto; }
        #et-body > p { margin:0 0 9px; padding:14px 16px 0; }
        #et-body > p:last-child { margin:0; padding-bottom:14px; }
    `;
    (document.head || document.documentElement).appendChild(style);
}

function setupResizer(divider, left, right) {
    let dragging = false, startX = 0, startL = 0, startR = 0;
    divider.addEventListener("mousedown", e => {
        dragging = true; startX = e.clientX;
        startL = left.getBoundingClientRect().width;
        startR = right.getBoundingClientRect().width;
        document.body.style.userSelect = "none";
        e.preventDefault();
    });
    document.addEventListener("mousemove", e => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const total = startL + startR;
        const newL = Math.min(Math.max(startL + dx, 100), total - 100);
        left.style.flex  = `0 0 ${newL}px`;
        right.style.flex = `0 0 ${total - newL}px`;
    });
    document.addEventListener("mouseup", () => {
        dragging = false;
        document.body.style.userSelect = "";
    });
}
