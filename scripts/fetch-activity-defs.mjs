#!/usr/bin/env node
// Regenerates src/activity-defs.json from the live Microscape game bundle.
// Run with: node scripts/fetch-activity-defs.mjs
// Requires Node 20+ (built-in fetch) and internet access to microscape.cc.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// injected.js is a MAIN-world IIFE that expects browser globals.  Stub them
// the same way injected.test.js does so the parsers are exposed via
// window.__MM_TEST_HOOKS__ without the script actually trying to contact the
// game server.
const hooks = {};
globalThis.window = {
  __MM_TEST_HOOKS__: hooks,
  addEventListener() {},
  postMessage() {},
  WebSocket: class {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    addEventListener() {}
    send() {}
  },
};
globalThis.WebSocket = globalThis.window.WebSocket;

// Suppress the IIFE's self-loading fetch so it doesn't fire against the game
// on import.  Restore native fetch afterwards for our own requests.
const nativeFetch = globalThis.fetch;
globalThis.fetch = () => Promise.reject(new Error('skip-initial-load'));
await import('../src/injected.js');
globalThis.fetch = nativeFetch;

const { parseActivityDefs } = hooks;
if (typeof parseActivityDefs !== 'function') {
  throw new Error('parseActivityDefs hook not found — was injected.js loaded correctly?');
}

process.stdout.write('Fetching Microscape play page…\n');
const playRes = await fetch('https://microscape.cc/play/');
const html = await playRes.text();

const bundleMatch = html.match(/src="(\/play\/assets\/index-[^"]+\.js)"/);
if (!bundleMatch) throw new Error('Could not locate bundle <script> tag in play page');
const bundleUrl = `https://microscape.cc${bundleMatch[1]}`;
process.stdout.write(`Fetching bundle: ${bundleUrl}\n`);

const bundleRes = await fetch(bundleUrl);
const bundle = await bundleRes.text();

process.stdout.write('Parsing activity defs…\n');
const rawDefs = parseActivityDefs(bundle);
process.stdout.write(`Parsed ${Object.keys(rawDefs).length} activities\n`);

// Keep only the four canonical fields (durationMs, level, xpPerCycle,
// inventoryChanges).  Deliberately omit dropItems / dropOdds / entity so
// buildChanceDropIndex behaviour is unchanged and the existing toEqual
// assertions in tests/activity-defs.test.js continue to pass.
const canonical = {};
for (const [id, def] of Object.entries(rawDefs)) {
  const entry = {};
  if (def.durationMs != null) entry.durationMs = def.durationMs;
  if (def.level != null) entry.level = def.level;
  if (def.xpPerCycle != null) entry.xpPerCycle = def.xpPerCycle;
  if (def.inventoryChanges != null) entry.inventoryChanges = def.inventoryChanges;
  canonical[id] = entry;
}

// Alphabetical sort for stable diffs.
const sorted = Object.fromEntries(
  Object.entries(canonical).sort(([a], [b]) => a.localeCompare(b))
);

const outPath = join(__dirname, '../src/activity-defs.json');
writeFileSync(outPath, JSON.stringify(sorted, null, 2) + '\n');
process.stdout.write(`Written: ${outPath}\n`);
