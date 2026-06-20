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
        if (bodyEl) bodyEl.innerHTML = content;
        const bannerEl = document.getElementById("et-banner");
        if (bannerEl) {
            bannerEl.textContent = banner;
            bannerEl.style.display = banner ? "flex" : "none";
        }
        return;
    }

    const origBg = globalThis.getComputedStyle(body).backgroundColor;
    injectStyles(origBg);

    const left = document.createElement("div");
    left.id = "et-left";
    while (body.firstChild) left.appendChild(body.firstChild);

    const divider = document.createElement("div");
    divider.id = "et-divider";

    const right = document.createElement("div");
    right.id = "et-right";
    right.innerHTML =
        `<button id="et-close" title="Close translation">&#x2715;</button>` +
        `<div id="et-banner" style="display:${banner ? "flex" : "none"}">${banner}</div>` +
        `<div id="et-body">${content}</div>`;

    body.appendChild(left);
    body.appendChild(divider);
    body.appendChild(right);
    body.style.cssText =
        "display:flex !important; flex-direction:row !important; " +
        "margin:0 !important; padding:0 !important; " +
        "height:100vh !important; overflow:hidden !important; box-sizing:border-box !important;";

    document.getElementById("et-close").addEventListener("click", closeSplitView);
    setupResizer(divider, left, right);
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
        #et-close   { position:absolute; top:10px; right:10px; z-index:10;
                      width:28px; height:28px; border-radius:50%;
                      background:rgba(0,0,0,.15); border:none; cursor:pointer;
                      font-size:14px; color:#333; line-height:1;
                      display:flex; align-items:center; justify-content:center; }
        #et-close:hover { background:rgba(0,0,0,.3); color:#000; }
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
