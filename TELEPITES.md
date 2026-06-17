# Email Translator – Thunderbird Extension

Translates the currently open email to Hungarian with one click.

## Installation

### 1. Create a ZIP / XPI file

From inside the extension directory (manifest.json must be at the root):

```bash
cd Thunderbird_translate
zip -r ../email-translator.xpi manifest.json background.js content_scripts/ icons/
```

### 2. Load into Thunderbird

**Developer mode (temporary, no ZIP needed):**
1. Thunderbird → `Tools` → `Add-ons and Themes`
2. Click the **gear icon** (⚙) → `Debug Add-ons`
3. A new page opens (`about:debugging`) — in the left sidebar click **`This Firefox`**
4. Click **`Load Temporary Add-on…`**
5. Select the `manifest.json` file (not the ZIP)

**Permanent installation:**
1. Thunderbird → `Tools` → `Add-ons and Themes`
2. Gear icon → `Install Add-on From File…`
3. Select the `email-translator.xpi` file

## Usage

1. Open an email in Thunderbird
2. A **blue translate button** (→ HU) appears in the message header toolbar (next to Reply / Forward / Archive)
3. Click it → a translation panel appears below the email body with the Hungarian text
4. Close the panel with the **✕** button in the top-right corner

## Translation service

The extension uses the **Google Translate unofficial API** (free, no key required):
- No API key needed
- Automatically detects the source language
- Maximum ~4800 characters per translation (longer texts are truncated)
- Approximate limit: 100–200 translations/day per IP address

## File structure

```
Thunderbird_translate/
├── manifest.json               # Extension manifest
├── background.js               # Button handler, text extraction, API call
├── content_scripts/
│   └── message_panel.js        # Translation panel injected below the email
└── icons/
    └── translate.svg           # Toolbar button icon
```

## Requirements

- Thunderbird 91.0 or later
- Internet connection for translation
