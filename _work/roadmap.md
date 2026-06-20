# Email Translator — Publication Roadmap

## Phase 1 — Blockers ✅ Done

### ✅ 1. Rewrite with standard WebExtension API
Replaced `experiment/` with `content/inject.js` registered via `messenger.messageDisplayScripts.register()`.
- `content/inject.js` — DOM manipulation, split view, close button, resizer
- `background.js` — uses `messenger.tabs.sendMessage(tabId, ...)` to drive the content script
- `manifest.json` — `experiment_apis` removed, `messageDisplayScripts` permission added
- `experiment/` directory deleted

---

### ✅ 2. Replace translation API
Replaced the unofficial Google `client=gtx` endpoint.
- **MyMemory** (`api.mymemory.translated.net`) — default, no API key required, auto-detects source language
- **DeepL** (`api-free.deepl.com`) — optional, higher quality, preserves HTML structure; user enters free API key in settings
- Provider selector and DeepL key field added to the options page
- Permissions updated: old `translate.googleapis.com` removed, new API hosts added

---

### ✅ 3. Privacy policy draft
Draft written at `_work/privacy-policy.md`.

**Remaining:** host the file at a stable public URL (e.g. `https://axeri.hu/email-translator/privacy`)
and add that URL to the ATN listing form under "Privacy Policy".

---

### ✅ 4. Remove unused `webNavigation` permission
Removed from `manifest.json`.

---

## Phase 2 — Important fixes ✅ Done

### ✅ 5. Support `mailbox://` and `news://` URI schemes
Resolved automatically by the messageDisplayScripts approach — the content script is injected
by Thunderbird regardless of URI scheme. No explicit filtering needed.

---

### ✅ 6. Close / dismiss button
`×` button added to the top-right corner of the right panel in `content/inject.js`.
`closeSplitView()` moves children back to body and removes all split view elements.

---

### ✅ 7. Truncation feedback for long emails
- MyMemory: truncates at 5,000 characters, appends "⚠ Translation truncated" notice as plain text
- DeepL: truncates at 30,000 characters, appends notice as styled HTML paragraph

---

### ✅ 8. Error handling for failed translation
- Network errors and API errors are caught in `run()` in `background.js`
- Error message is displayed in the split view (red text)
- "No translatable content" shown if the email has no extractable text

---

## Phase 3 — Quality & store listing

### ✅ 11. Version number
Reset to `1.0.0` in `manifest.json`. Minimum Thunderbird version updated to `102.0`.

---

### ⏳ 9. Testing matrix

| Scenario | Status |
|---|---|
| Thunderbird 115 (Supernova) — IMAP | ? |
| Thunderbird 128 — IMAP | ? |
| Thunderbird 128 — POP3 / local folder | ? |
| Email opened in new tab | ? |
| Dark theme | ? |
| `multipart/alternative` (HTML + plain text) | ? |
| Quoted-printable encoded HTML | ? |
| Plain text only email | ? |
| Auto-translate enabled | ? |
| MyMemory translation (default) | ? |
| DeepL translation (with key) | ? |
| Language switching (non-default target) | ? |
| Close button and re-open | ? |
| Long email truncation notice | ? |

---

### ⏳ 10. PNG icon
SVG icons are not displayed in all ATN contexts (listing page, search results).

- Export `icons/translate.svg` to PNG at 48×48 and 96×96
- Update `manifest.json` `icons` block to reference PNG files
- Keep SVG for `message_display_action.default_icon` — SVG works in the toolbar

---

### ⏳ 12. ATN submission package

- [ ] Host privacy policy at a stable URL; add to ATN listing
- [ ] Write short English description (≤250 chars) and a longer one
- [ ] Take 2+ screenshots at 1280×800 (split view + settings page)
- [ ] Write reviewer notes:
  - `messagesRead` — reads email body content for translation
  - `messageDisplayScripts` — injects content script into the email display pane
  - `storage` — caches translations locally, persists settings
  - External services contacted: MyMemory / DeepL (user's choice)
  - How to test: install → open any email → click toolbar button
- [ ] Build `.xpi`: zip extension directory (exclude `_work/`), rename to `.xpi`
- [ ] Submit on [addons.thunderbird.net](https://addons.thunderbird.net) — "Listed" visibility

---

## Remaining work summary

```
#9  Testing (variable time)
#10 PNG icon export (~30 min)
#12 ATN submission (~1h) — after hosting privacy policy
```
