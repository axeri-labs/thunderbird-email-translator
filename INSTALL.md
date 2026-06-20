# Email Translator — Thunderbird Extension

Translates the open email into your chosen language and shows it side-by-side with the original.

## Installation

### 1. Build XPI package

Run from inside the extension directory (where `manifest.json` is):

```bash
cd Thunderbird_translate
zip -r ../email-translator.xpi . --exclude "_work/*" --exclude "*.git*" --exclude "*.xpi"
```

### 2. Load into Thunderbird

**Developer mode (temporary, no XPI needed):**
1. Thunderbird → `Tools` → `Add-ons and Themes`
2. Click the **gear icon** (⚙) → `Debug Add-ons`
3. A new page opens (`about:debugging`) — click **`This Thunderbird`** in the left sidebar
4. Click **`Load Temporary Add-on…`**
5. Select the `manifest.json` file (not the XPI)

**Permanent installation:**
1. Thunderbird → `Tools` → `Add-ons and Themes`
2. Gear icon → `Install Add-on From File…`
3. Select the `email-translator.xpi` file

## Usage

1. Open an email in Thunderbird
2. Click the **translate button** in the message toolbar
3. The email splits: original on the left, translation on the right
4. Drag the centre divider to resize panels
5. Click **✕** in the top-right corner to close the translation

## Translation providers

| Provider | Key required | Quality | Notes |
|---|---|---|---|
| **Google Translate** (default) | No | Good | Auto-detects source language, no limits |
| **MyMemory** | No | Good | IP-based: ~10 req/min, 1,000 words/day |
| **DeepL** | Yes (free) | Excellent | 500,000 characters/month, HTML-aware |

Switch providers in **Settings** (gear icon in Add-ons manager).

## File structure

```
Thunderbird_translate/
├── manifest.json               # Extension manifest (MV2)
├── background.html             # Background page loader
├── background.js               # Main logic: translation, caching, race condition handling
├── content/
│   └── inject.js               # Split view injected into the email display page
├── options/
│   ├── options.html            # Settings page UI
│   └── options.js              # Settings page logic
├── icons/
│   ├── translate.svg           # Toolbar button icon
│   ├── translate-48.png        # Extension icon (48×48)
│   └── translate-96.png        # Extension icon (96×96)
└── docs/
    └── privacy/
        └── index.html          # Privacy policy (GitHub Pages)
```

## Requirements

- Thunderbird 102.0 or later
- Internet connection for translation
