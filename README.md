# Smart Right-Click Browser Extension

Premium Manifest V3 extension for Chrome and Edge.

Highlight text on any webpage -> right-click -> choose **Analyze Selection** -> open a cinematic results page with:
- query-focused header
- Wikipedia summary
- dynamic entity data card (table + image)
- animated right-side negative-news scanner drawer

## Ownership

This is a private proprietary project. See [NOTICE.md](NOTICE.md).

No open-source license is granted. Do not copy, redistribute, publish, sublicense, or reuse this code without explicit written permission from the owner.

## What It Does

1. Adds a single selection-only context menu item: `Analyze Selection`.
2. Captures highlighted text using `info.selectionText`.
3. Detects a demo entity type (`Person` / `Place` / `Other`).
4. Opens one results tab (`results.html?id=<requestId>`).
5. Renders:
   - searched query
   - metadata strip
   - full description (Wikipedia intro)
   - image + dynamic table fields from Wikidata when available
6. On **Scan Negative News**:
   - opens a right sliding drawer
   - calls all configured news providers (GNews + NewsAPI)
   - merges + deduplicates results
   - labels provider attribution on status and per result row

## File Tree

```text
smart-right-click/
  manifest.json
  background.js
  results.html
  results.js
  results.css
  config.example.js
  icons/
    icon16.png
    icon48.png
    icon128.png
  NOTICE.md
  README.md
```

## Architecture

### `manifest.json`
- MV3 config
- service worker entry: `background.js`
- permissions: `contextMenus`, `storage`, `tabs`
- host permissions for Wikipedia, Wikidata, GNews, NewsAPI

### `background.js`
- creates one context menu item on install
- captures selected text
- builds request payload
- writes payload into `chrome.storage.session`
- opens `results.html` with request id

### `results.html`
- premium page shell
- left rail: Data Card + News summary + scan button
- right stage: Description panel
- off-canvas right drawer: scrollable negative-news scanner

### `results.js`
- loads payload from session storage
- fetches summary + thumbnail from Wikipedia
- fetches structured fields from Wikidata
- renders dynamic table fields (includes optional fields when available)
- scans news on button click only
- queries both providers, merges and dedupes results
- applies provider attribution
- handles animations, drawer open/close, and reduced-motion friendly fallbacks

### `results.css`
- premium dark/violet visual system
- responsive grid layout
- table/td hierarchy styling
- dynamic tones (query hue + numeric emphasis)
- animated drawer and interaction states

### `config.example.js`
- safe template for local API key config
- copy to `config.js` for local testing
- `config.js` is ignored by git and should not be committed

## Setup

## 1) Configure API Keys

Copy `config.example.js` to `config.js`, then edit `config.js`:

```js
const CONFIG = {
  GNEWS_API_KEY: "YOUR_GNEWS_KEY",
  NEWS_API_KEY: "YOUR_NEWSAPI_KEY"
};
```

Never commit real API keys.

## 2) Load Extension (Chrome)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `smart-right-click` folder

## 3) Load Extension (Edge)

1. Open `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `smart-right-click` folder

## Usage

1. Highlight text on any page (example: `Cristiano Ronaldo`)
2. Right-click -> `Analyze Selection`
3. Review summary + data card
4. Click `Scan Negative News` to open animated right drawer and fetch news

## Data Sources

- Summary + image: **Wikipedia API**
- Structured fields: **Wikidata API**
- News scanning: **GNews API + NewsAPI** (aggregate mode)

## Validation Checklist

- Context menu appears only on selected text
- Single menu item only (`Analyze Selection`)
- Query opens in one extension results page
- Full description shown
- Data card image renders when available
- Dynamic table fills with available fields
- Scan opens right-side drawer with animation
- Drawer is scrollable and closable (`X`, backdrop, `Esc`)
- News status shows provider usage
- News rows show provider attribution

## Known Limitations

- Entity detection is heuristic (demo quality)
- Client-side API keys are exposed (POC choice)
- Provider quotas and plan restrictions apply
- Wikipedia/Wikidata coverage varies by entity
- News quality and dedupe depend on provider response data

## Sharing Safely

- Keep the GitHub repository private.
- Share access only with trusted reviewers/collaborators.
- Do not add an open-source license unless you intentionally want to grant reuse rights.
- Rotate any API keys that were ever committed or shared.
- Use `config.example.js` in GitHub and keep real local keys in ignored `config.js`.

## Dev Notes

- `results.html` supports preview mode for design screenshots:
  - `results.html?preview=1&q=Cristiano%20Ronaldo&type=Person`
- Keep `apply_patch` edits scoped to this tree to avoid style drift.
