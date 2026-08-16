import { useState } from 'react';
import { formatTickEntry } from '../utils/format';

export default function DebugSection({ rawMe, tickLog }) {
  const [copyLabel, setCopyLabel] = useState('Copy');

  const tickLogText = tickLog?.length
    ? tickLog.map(formatTickEntry).join('\n')
    : '(no ticks yet)';

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

  const btnClass = `copy-log-btn${copyLabel === 'Copied!' ? ' copied' : ''}`;

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
          </span>
          <button className={btnClass} onClick={handleCopy}>{copyLabel}</button>
        </div>
        <pre id="tick-log-pre">{tickLogText}</pre>
      </details>
    </>
  );
}
