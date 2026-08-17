import { useState } from 'react';
import { formatTickEntry } from '../utils/format';

export default function DebugSection({
  rawMe,
  tickLog,
  etaDebugLog,
  etaDebugLogVersion,
}) {
  const [copyLabel, setCopyLabel] = useState('Copy');
  const [etaCopyLabel, setEtaCopyLabel] = useState('Copy');

  const tickLogText = tickLog?.length
    ? tickLog.map(formatTickEntry).join('\n')
    : '(no ticks yet)';
  const etaDebugAvailable = Array.isArray(etaDebugLog);
  const etaDebugLogText = !etaDebugAvailable
    ? '(ETA debug log unavailable from background — reload the extension)'
    : etaDebugLog.length
    ? `${etaDebugLog.length} ETA debug entries captured. Use Copy to export full JSON.`
    : '(no ETA debug entries yet)';

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(tickLog, null, 2));
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy'), 1500);
    } catch {
      setCopyLabel('Error');
      setTimeout(() => setCopyLabel('Copy'), 1500);
    }
  }

  async function handleEtaCopy() {
    try {
      const payload = etaDebugAvailable
        ? etaDebugLog
        : {
            error: 'eta-debug-log-unavailable',
            etaDebugLogVersion,
            message: 'GET_STATUS did not include etaDebugLog. Reload the extension background service worker.',
          };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setEtaCopyLabel('Copied!');
      setTimeout(() => setEtaCopyLabel('Copy'), 1500);
    } catch {
      setEtaCopyLabel('Error');
      setTimeout(() => setEtaCopyLabel('Copy'), 1500);
    }
  }

  const btnClass = `copy-log-btn${copyLabel === 'Copied!' ? ' copied' : ''}`;
  const etaBtnClass = `copy-log-btn${etaCopyLabel === 'Copied!' ? ' copied' : ''}`;

  return (
    <>
      <details className="debug-details">
        <summary>Debug — raw <code>me</code> state</summary>
        <pre id="debug-me">{rawMe != null ? JSON.stringify(rawMe, null, 2) : ''}</pre>
      </details>
      <details className="debug-details">
        <summary>Debug — tick log</summary>
        <div className="tick-log-header">
          <span className="tick-log-hint">
            Newest first · <code>rd</code>=active ticks · <code>lb</code>=loot bag · <code>gen</code>=items · <code>bt</code>=bank trips · <code>cd</code>=ETA cycle dur · <code>od</code>=observed dur · <code>sm</code>=samples
            · <code>gr</code>/<code>rr</code>=goal/runout rate mode
          </span>
          <button className={btnClass} onClick={handleCopy}>{copyLabel}</button>
        </div>
        <pre id="tick-log-pre">{tickLogText}</pre>
      </details>
      <details className="debug-details">
        <summary>Debug — ETA debug log</summary>
        <div className="tick-log-header">
          <span className="tick-log-hint">
            Newest first · JSON · v{etaDebugLogVersion ?? '?'} · captures ETA model, rate samples, bank projection, activity phase, and inventory deltas
          </span>
          <button className={etaBtnClass} onClick={handleEtaCopy}>{etaCopyLabel}</button>
        </div>
        <pre id="eta-debug-log-pre">{etaDebugLogText}</pre>
      </details>
    </>
  );
}
