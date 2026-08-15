# Microscape Minion

A Chrome extension for [Microscape](https://microscape.cc/play/) that watches your character in real time and shows you:

- **Idle alerts** — get notified the moment your character stops working
- **Material runout** — see how many cycles of materials you have left and when they'll run out
- **Goal tracker** — set a target item and quantity and get an ETA including bank trips

Microscape Minion is read-only. It never sends anything to the game — it only watches.

---

## Installation

Chrome extensions from outside the Chrome Web Store need to be loaded manually. This takes about two minutes.

### Step 1 — Download the extension

1. Go to the [Releases](https://github.com/jcarvin/MicroscapeMinion/releases) page on GitHub
2. Download the latest `MicroscapeMinion.zip` file
3. Unzip it somewhere you'll remember — your Desktop or Documents folder works fine

> **Important:** Don't move or delete the unzipped folder after installing. Chrome loads the extension directly from that folder every time it starts.

### Step 2 — Open Chrome's Extensions page

In Chrome, navigate to:

```
chrome://extensions
```

You can also get there by clicking the three-dot menu (⋮) in the top-right corner of Chrome → **Extensions** → **Manage Extensions**.

### Step 3 — Turn on Developer Mode

In the top-right corner of the Extensions page, you'll see a toggle labeled **Developer mode**. Turn it on.

Once enabled, three new buttons will appear at the top left of the page: **Load unpacked**, Pack extension, and Update.

> Developer mode just means you can install extensions that aren't in the Chrome Web Store. It doesn't change anything else about how Chrome works.

### Step 4 — Load the extension

1. Click **Load unpacked**
2. In the file picker that opens, navigate to the folder you unzipped in Step 1
3. Select that folder and click **Open** (or **Select Folder** on some systems)

Microscape Minion will appear in your extensions list with a green toggle showing it's active.

### Step 5 — Pin it to your toolbar (recommended)

1. Click the puzzle-piece icon (🧩) in the top-right corner of Chrome
2. Find **Microscape Minion** in the list
3. Click the pin icon next to it

The Microscape Minion icon will now appear in your toolbar for easy access while you play.

---

## How to use it

1. Open [Microscape](https://microscape.cc/play/) and log in
2. Click the Microscape Minion icon in your toolbar
3. The popup shows your current activity status and any active alerts

**Goal tracker:** While your character is doing an activity, click the item dropdown in the Goal Tracker section, pick what you're producing, enter a target quantity, and hit **Set**. The extension will calculate how long it'll take including bank trips.

**Material runout:** This appears automatically when your materials are running low. No setup needed.

---

## Updating

If a new version is released:

1. Download the new zip from the Releases page
2. Replace the contents of your existing folder with the new files (or unzip to a new folder)
3. Go back to `chrome://extensions` and click the refresh icon on the Microscape Minion card

---

## Troubleshooting

**The popup shows "Not connected"**
Make sure you have Microscape open in a Chrome tab and you're logged in. The extension connects automatically when it detects the game.

**The extension disappeared after a Chrome update**
Chrome occasionally disables unpacked extensions after updates. Go to `chrome://extensions`, find Microscape Minion, and turn its toggle back on. If it's gone entirely, repeat Step 4.

**I get a warning about "Developer mode extensions"**
This is a normal Chrome notice about extensions loaded outside the Web Store. Click the X to dismiss it — it's safe to ignore.
