// MAIN-world script — runs at document_start, before any page module scripts.
// Wraps window.WebSocket to intercept every raw frame on the /server/ws connection.
// Posts decoded frames to the page via window.postMessage; the isolated-world
// content.js picks them up and forwards them to the background service worker.

(function () {
  'use strict';

  const RealWebSocket = window.WebSocket;

  function MicroscapeWebSocket(url, protocols) {
    const ws = protocols != null
      ? new RealWebSocket(url, protocols)
      : new RealWebSocket(url);

    const urlStr = url instanceof URL ? url.href : String(url);
    if (!urlStr.includes('/server/ws')) return ws;

    ws.addEventListener('message', (evt) => {
      if (typeof evt.data !== 'string') return;
      const frame = decodeFrame(evt.data);
      if (frame) post('server', frame);
    });

    const origSend = ws.send.bind(ws);
    ws.send = (data) => {
      if (typeof data === 'string') {
        const frame = decodeFrame(data);
        if (frame) post('client', frame);
      }
      return origSend(data);
    };

    return ws;
  }

  // Preserve static members (CONNECTING / OPEN / CLOSING / CLOSED)
  Object.setPrototypeOf(MicroscapeWebSocket, RealWebSocket);
  MicroscapeWebSocket.prototype = RealWebSocket.prototype;
  window.WebSocket = MicroscapeWebSocket;

  // ── Engine.IO / Socket.IO minimal frame decoder ───────────────────────────
  //
  // Wire format (text-mode):
  //   <eio_type><sio_type><json_payload>
  //
  // Engine.IO types we care about:
  //   '4' = MESSAGE  (only type that carries Socket.IO data)
  //
  // Socket.IO types (after the EIO prefix):
  //   '0' = CONNECT       '1' = DISCONNECT
  //   '2' = EVENT         '3' = ACK
  //   '4' = CONNECT_ERROR '5' = BINARY_EVENT  '6' = BINARY_ACK
  //
  // A server → client event looks like:  42["update",{...patch...}]
  //   eio='4', sio='2', payload='["update",{...}]'

  function decodeFrame(raw) {
    if (raw[0] !== '4') return null; // not an EIO MESSAGE

    const sioType = raw[1];
    const body = raw.slice(2);

    if (sioType === '2' || sioType === '3') {
      // EVENT or ACK — body is a JSON array
      try {
        const arr = JSON.parse(body);
        if (!Array.isArray(arr)) return null;
        return { sioType, event: arr[0], args: arr.slice(1) };
      } catch {
        return null;
      }
    }

    // Other SIO types (CONNECT, DISCONNECT, etc.) — pass raw for debug logging
    return { sioType, raw: body };
  }

  function post(direction, frame) {
    window.postMessage({ __mm: true, direction, frame }, '*');
  }
})();

// ── Dynamic activityDef loading ───────────────────────────────────────────────
// Fetches the live game bundle and parses all activityDefs so the extension
// stays in sync when game devs redeploy without requiring a manual JSON update.
//
// Fetches /play/ to discover the current bundle URL (can't query the DOM at
// document_start since HTML hasn't been parsed yet), then fetches the bundle
// and posts parsed defs through the existing __mm relay.

(function loadActivityDefs() {
  fetch('/play/')
    .then((r) => r.text())
    .then((html) => {
      const m = html.match(/src="(\/play\/assets\/index-[^"]+\.js)"/);
      if (!m) return Promise.reject('bundle URL not found');
      return fetch(m[1]).then((r) => r.text());
    })
    .then((bundle) => {
      const defs = parseActivityDefs(bundle);
      const zones = parseZones(bundle);
      const xpTable = parseXpTable(bundle);
      if (Object.keys(defs).length > 0) {
        window.postMessage({ __mm: true, type: 'ACTIVITY_DEFS', defs, zones, xpTable }, '*');
      }
    })
    .catch(() => {});

  function parseActivityDefs(bundle) {
    const defs = {};
    // Matches activity defs in the (non-minified) game bundle. Optional string
    // fields like customActionText/customPrepText may appear between name and level.
    // Groups: 1=id, 2=exp (xpPerCycle), 3=duration, 4=inventoryChanges body
    const re = /\{\s*id:\s*`([^`]+)`(?:,\s*\w+:\s*`[^`]*`)*,\s*level:\s*\d+,\s*exp:\s*(\d+),\s*duration:\s*(\d+),\s*entity:\s*`[^`]+`,\s*inventoryChanges:\s*\{([^}]+)\}/g;
    let m;
    while ((m = re.exec(bundle)) !== null) {
      const id = m[1];
      const xpPerCycle = parseInt(m[2], 10);
      const durationMs = (parseInt(m[3], 10) + 6) * 2000;
      const changes = {};
      for (const part of m[4].split(',')) {
        const colon = part.indexOf(':');
        if (colon < 0) continue;
        const k = part.slice(0, colon).trim();
        const v = part.slice(colon + 1).trim();
        if (!k || v.includes('/')) continue; // skip pet drop odds (e.g. 1/500)
        const n = parseInt(v, 10);
        if (!isNaN(n)) changes[k] = n;
      }
      defs[id] = { durationMs, xpPerCycle, inventoryChanges: changes };
    }
    return defs;
  }

  function parseXpTable(bundle) {
    // Prefer a bundled table if one is exposed. Microscape's XP curve is the
    // OSRS curve with the per-level points multiplied by 10 before division.
    const m = bundle.match(/\[0\s*,\s*830\s*,\s*1740[\d,\s]*?\]/);
    if (m) {
      try {
        const nums = m[0].match(/\d+/g).map(Number);
        if (nums.length >= 20 && nums[16] === 31174) {
          // Bundle array is 0-indexed (nums[0]=level1=0 XP, nums[1]=level2=830 XP).
          // Prepend a dummy entry so XP_TABLE[level] = min XP for that level.
          return [0, ...nums];
        }
      } catch {}
    }
    return computeMicroscapeXpTable();
  }

  function computeMicroscapeXpTable() {
    // table[level] = min XP required for that level (1-indexed; table[0] unused).
    const table = [0, 0]; // table[1] = level 1 = 0 XP
    let points = 0;
    for (let level = 1; level <= 98; level++) {
      points += Math.floor(10 * (level + 300 * Math.pow(2, level / 7)));
      table.push(Math.floor(points / 4)); // table[level+1] = XP for level+1
    }
    return table;
  }

  function parseZones(bundle) {
    const zones = {};
    // Each zone entry: "zone-id": { name: `...`, mapPos: [x, y], ... }
    const re = /"([\w-]+)":\s*\{\s*name:\s*`[^`]+`,\s*mapPos:\s*\[(\d+),\s*(\d+)\]/g;
    let m;
    while ((m = re.exec(bundle)) !== null) {
      zones[m[1]] = [parseInt(m[2], 10), parseInt(m[3], 10)];
    }
    return zones;
  }
})();
