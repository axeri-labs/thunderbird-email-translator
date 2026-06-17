if (!globalThis.__etLoaded) {
    globalThis.__etLoaded = true;
    messenger.runtime.onMessage.addListener(onMessage);
}

function onMessage(msg) {
    if (msg.action === "startTranslation") createSplitView();
    else if (msg.action === "showTranslation") showTranslation(msg.text, msg.lang);
    else if (msg.action === "translationError") showError(msg.error);
}

function createSplitView() {
    // Already split — just reset the right panel
    const existing = document.getElementById("et-right");
    if (existing) {
        existing.innerHTML = loadingHtml();
        return;
    }

    injectStyles();

    // Move all current body children into the left column
    const left = document.createElement("div");
    left.id = "et-left";
    while (document.body.firstChild) {
        left.appendChild(document.body.firstChild);
    }

    const divider = document.createElement("div");
    divider.id = "et-divider";

    const right = document.createElement("div");
    right.id = "et-right";
    right.innerHTML = loadingHtml();

    document.body.appendChild(left);
    document.body.appendChild(divider);
    document.body.appendChild(right);

    // Override body layout to flex row
    document.body.style.cssText =
        "display:flex !important; flex-direction:row !important; " +
        "margin:0 !important; padding:0 !important; " +
        "height:100vh !important; overflow:hidden !important; box-sizing:border-box !important;";

    initResizer(divider, left, right);
}

function showTranslation(text, lang) {
    const right = document.getElementById("et-right");
    if (!right) return;

    const badge = right.querySelector(".et-lang");
    if (badge) {
        let langLabel;
        if (lang && lang !== "hu") langLabel = lang.toUpperCase() + " → HU";
        else if (lang === "hu") langLabel = "already Hungarian";
        else langLabel = "→ HU";
        badge.textContent = langLabel;
    }

    const body = right.querySelector(".et-body");
    if (!body) return;

    const paragraphs = (text || "")
        .split(/\n+/)
        .map(l => l.trim())
        .filter(l => l.length > 0);

    body.innerHTML = paragraphs.length === 0
        ? "<p><em>(Empty translation received.)</em></p>"
        : paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join("");
}

function showError(msg) {
    const body = document.querySelector("#et-right .et-body");
    if (body) body.innerHTML = `<div class="et-error">⚠ ${escapeHtml(msg)}</div>`;
}

function loadingHtml() {
    return `
        <div class="et-header">
            <span class="et-hu-badge">HU</span>
            Hungarian Translation
            <span class="et-lang"></span>
        </div>
        <div class="et-body">
            <div class="et-loading">
                <span class="et-spinner"></span>
                Translating…
            </div>
        </div>`;
}

function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
        #et-left {
            flex: 1 1 50%;
            overflow-y: auto;
            height: 100%;
            min-width: 0;
        }
        #et-divider {
            flex: 0 0 4px;
            background: #0055aa;
            cursor: col-resize;
            height: 100%;
        }
        #et-right {
            flex: 1 1 50%;
            display: flex;
            flex-direction: column;
            height: 100%;
            min-width: 0;
            background: #eef5ff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
            font-size: 13px;
            color: #111;
        }
        #et-right .et-header {
            background: #0055aa;
            color: #fff;
            padding: 8px 12px;
            display: flex;
            align-items: center;
            gap: 7px;
            font-weight: 600;
            font-size: 13px;
            flex-shrink: 0;
            user-select: none;
        }
        #et-right .et-hu-badge {
            background: #cc0000;
            color: #fff;
            font-size: 11px;
            font-weight: bold;
            border-radius: 3px;
            padding: 1px 5px;
            letter-spacing: 0.5px;
        }
        #et-right .et-lang {
            font-size: 11px;
            font-weight: normal;
            background: rgba(255,255,255,0.2);
            border-radius: 4px;
            padding: 1px 6px;
            margin-left: auto;
        }
        #et-right .et-body {
            flex: 1;
            overflow-y: auto;
            padding: 14px 16px;
            line-height: 1.7;
        }
        #et-right .et-body p {
            margin: 0 0 9px 0;
        }
        #et-right .et-body p:last-child { margin-bottom: 0; }
        #et-right .et-loading {
            color: #555;
            font-style: italic;
            display: flex;
            align-items: center;
            gap: 9px;
        }
        #et-right .et-spinner {
            display: inline-block;
            width: 15px;
            height: 15px;
            border: 2px solid #aac4e8;
            border-top-color: #0055aa;
            border-radius: 50%;
            animation: et-spin 0.8s linear infinite;
            flex-shrink: 0;
        }
        @keyframes et-spin { to { transform: rotate(360deg); } }
        #et-right .et-error {
            color: #aa0000;
            background: #fff0f0;
            border: 1px solid #ffcccc;
            border-radius: 4px;
            padding: 9px 11px;
        }
    `;
    document.head.appendChild(style);
}

// Drag-to-resize the divider
function initResizer(divider, left, right) {
    let dragging = false;
    let startX = 0;
    let startLeftW = 0;
    let startRightW = 0;

    divider.addEventListener("mousedown", (e) => {
        dragging = true;
        startX = e.clientX;
        startLeftW = left.getBoundingClientRect().width;
        startRightW = right.getBoundingClientRect().width;
        document.body.style.userSelect = "none";
        e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const total = startLeftW + startRightW;
        const newLeft = Math.min(Math.max(startLeftW + dx, 100), total - 100);
        left.style.flex = `0 0 ${newLeft}px`;
        right.style.flex = `0 0 ${total - newLeft}px`;
    });

    document.addEventListener("mouseup", () => {
        dragging = false;
        document.body.style.userSelect = "";
    });
}

function escapeHtml(str) {
    return str
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
