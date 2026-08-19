# Microscape Minion

A browser extension for [Microscape](https://microscape.cc/play/) that watches your character in real time and shows you:

- **Idle alerts** — get notified the moment your character stops working
- **Material runout** — see how many cycles of materials you have left and when they'll run out
- **Goal tracker** — set a target item and quantity and get an ETA including bank trips

Microscape Minion is read-only. It never sends anything to the game — it only watches.

Available for Chrome and Firefox.

---

## Installation

### Chrome

Extensions from outside the Chrome Web Store need to be loaded manually. This takes about two minutes.

**Step 1 — Download the extension**

1. Go to the [Releases](https://github.com/jcarvin/MicroscapeMinion/releases) page on GitHub
2. Download the latest `microscape-minion-*.zip` file
3. Unzip it somewhere you'll remember — your Desktop or Documents folder works fine

> **Important:** Don't move or delete the unzipped folder after installing. Chrome loads the extension directly from that folder every time it starts.

**Step 2 — Open Chrome's Extensions page**

In Chrome, navigate to:

```
chrome://extensions
```

**Step 3 — Turn on Developer Mode**

In the top-right corner of the Extensions page, turn on the **Developer mode** toggle. Three buttons will appear: **Load unpacked**, Pack extension, and Update.

**Step 4 — Load the extension**

1. Click **Load unpacked**
2. Navigate to the folder you unzipped in Step 1
3. Select that folder and click **Open**

Microscape Minion will appear in your extensions list with a green toggle.

**Step 5 — Pin it to your toolbar (recommended)**

1. Click the puzzle-piece icon (🧩) in the top-right corner of Chrome
2. Find **Microscape Minion** and click the pin icon next to it

---

### Firefox

Firefox extensions from outside AMO can be loaded temporarily for testing. For a permanent install, use the Firefox Add-ons store once it's listed.

**Step 1 — Download the extension**

1. Go to the [Releases](https://github.com/jcarvin/MicroscapeMinion/releases) page on GitHub
2. Download the latest `microscape-minion-firefox-*.xpi` file

**Step 2 — Install the XPI**

Open Firefox and navigate to:

```
about:addons
```

Click the gear icon → **Install Add-on From File…** → select the `.xpi` file. Click **Add** when prompted.

Microscape Minion will appear in your extensions list and remain installed permanently.

---

## How to use it

1. Open [Microscape](https://microscape.cc/play/) and log in
2. Click the Microscape Minion icon in your toolbar
3. The popup shows your current activity status and any active alerts

**Goal tracker:** While your character is doing an activity, click the item dropdown in the Goal Tracker section, pick what you're producing, enter a target quantity, and hit **Set**. The extension will calculate how long it'll take including bank trips.

**Material runout:** This appears automatically when your materials are running low. No setup needed.

---

## Updating

**Chrome:** Download the new zip from the Releases page, replace the contents of your existing folder, then go to `chrome://extensions` and click the refresh icon on the Microscape Minion card.

**Firefox:** Download and install the new `.xpi` file the same way you installed the original. Firefox will update the existing installation automatically.

---

## Release notes

<details>
<summary>Release notes</summary>

### v0.1.9

- Track multiple persistent item goals with per-goal progress, ETA calibration, and completion notifications.
- Search the full known item catalog, with outputs from the current activity listed first and ETA shown only for related goals.
- Add, remove, edit, and drag to reorder goal rows, with a subtle highlight on goals related to the current activity.
- Persist goals and their order across browser and extension restarts while preserving existing single-goal data during migration.

### v0.1.8

- Refactor `background.js` into 14 focused ES modules (constants, state, patch, activity utilities, inventory, runout, calibration, rate tracking, ETA calculation, notifications, debug log, and status).
- Fix build pipeline: `vite.config.js` previously only copied four hardcoded files to dist, so the new modules were never shipped and the service worker failed to load silently.

### v0.1.7

- Fix bank-trip ETA accounting so in-progress banking and travel are not charged as a future trip.
- Extend ETA warmup to 5 minutes and show a subtle live `Calibrating...` countdown on warming ETAs.
- Clear goal tracking when switching work activities while preserving warmed goal calibration when updating the same goal item.

### v0.1.6

- Improve ETA calibration with warmed observed rates for goal accumulation, material runout, skill levels, and combat consumable depletion.
- Reset stale ETA rate windows after long gaps or inventory refills so idle time and restocks do not skew estimates.
- Add background tests for rate-based goal, runout, skill, and combat-consumable ETAs.

### v0.1.5

- Add Firefox extension support with a Firefox-specific manifest and build flow.
- Update packaging so Chrome and Firefox artifacts are generated into `artifacts/` with browser-specific filenames.
- Expand README installation, development, and publishing instructions for both browsers.

### v0.1.4

- Add a controlled ETA information tooltip with clearer estimate caveats.

### v0.1.3

- Add piety training material runout support.
- Add level goal tracking for piety training.

### v0.1.2

- Show required materials for the selected level goal in the runout card.

### v0.1.1

- Ship the React and Vite popup refactor as the first explicit version bump.

### v0.1.0

- Establish the package-based extension build and initial `0.1.0` version metadata.

</details>

---

## Troubleshooting

**The popup shows "Not connected"**
Make sure you have Microscape open in a tab and you're logged in. The extension connects automatically when it detects the game.

**Chrome: the extension disappeared after an update**
Chrome occasionally disables unpacked extensions after updates. Go to `chrome://extensions`, find Microscape Minion, and turn its toggle back on. If it's gone entirely, repeat the load steps above.

**Chrome: I get a warning about "Developer mode extensions"**
This is a normal Chrome notice about extensions loaded outside the Web Store. Click the X to dismiss it — it's safe to ignore.

---

## Development

### Prerequisites

- Node 22 (`nvm use` will pick the right version from `.nvmrc`)
- `npm install`

### Chrome

```bash
# Build (outputs to dist-chrome/)
npm run build:chrome

# Build and watch for changes
npm run dev

# Load in Chrome
# 1. Go to chrome://extensions
# 2. Enable Developer mode
# 3. Click "Load unpacked" and select the dist-chrome/ folder
# 4. After rebuilding, click the refresh icon on the extension card
```

### Firefox

```bash
# Build (outputs to dist-firefox/)
npm run build:firefox

# Launch Firefox with the extension pre-loaded (auto-reloads on rebuild)
npm run firefox:run

# Or load manually:
# 1. Go to about:debugging → "This Firefox"
# 2. Click "Load Temporary Add-on…"
# 3. Select dist-firefox/manifest.json

# Validate the extension against Firefox's linter
npm run firefox:lint
```

### Tests

```bash
npm test
npm run test:ui   # opens Vitest UI
```

---

## Publishing

Run `npm run zip:all` to build both zips in one step. They land in `artifacts/`.

### Chrome Web Store

```bash
npm run zip:chrome
```

This builds and packages the extension into `artifacts/microscape-minion-<version>-chrome.zip`. Upload that file to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

### Firefox Add-ons (AMO)

```bash
npm run zip:firefox
```

This produces `artifacts/microscape-minion-<version>-firefox.zip`. Upload that to [addons.mozilla.org](https://addons.mozilla.org/developers/).

AMO requires a source code submission alongside the built extension because this project uses Vite. Create the source ZIP with:

```bash
zip -r microscape-minion-source-<version>.zip . \
  -x 'node_modules/*' -x 'dist-chrome/*' -x 'dist-firefox/*' \
  -x 'artifacts/*' -x '*.DS_Store' -x '.git/*'
```

Include this reviewer note in the AMO submission form:

> Run `npm ci && npm run build:firefox` to reproduce the extension. Node version is in `.nvmrc` (22.14.0).

### Versioning

Before publishing a new release or opening a PR, bump the version in all versioned files and add a matching entry at the top of the collapsible release notes section:

- `package.json`
- `package-lock.json`
- `manifest.json`
- `manifest.firefox.json`

Run `npm run check:release` to verify the versions match and the README has release notes for the new version.
