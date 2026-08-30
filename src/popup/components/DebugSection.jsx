import { useState } from 'react';
import styled from 'styled-components';
import { formatTickEntry } from '../utils/format';

const DebugDetails = styled.details`
  padding: 0 12px;

  summary {
    font-size: 10px;
    color: ${({ theme }) => theme.muted};
    cursor: pointer;
    padding: 8px 0 4px;
    list-style: none;
    user-select: none;

    &::before { content: '▶ '; }
  }

  &[open] summary::before { content: '▼ '; }
`;

const DebugMePre = styled.pre`
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.muted};
  font: 10px/1.5 'Cascadia Code', 'Fira Code', monospace;
  margin-bottom: 4px;
  max-height: 180px;
  overflow: auto;
  padding: 6px 8px;
  white-space: pre-wrap;
  word-break: break-all;
`;

const DebugPre = styled.pre`
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.muted};
  font: 9.5px/1.5 'Cascadia Code', 'Fira Code', monospace;
  margin-bottom: 4px;
  max-height: 220px;
  overflow: auto;
  padding: 6px 8px;
  white-space: pre;
`;

const TickLogHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 4px;
`;

const TickLogHint = styled.span`
  font-size: 9px;
  color: ${({ theme }) => theme.muted};
  flex: 1;
  line-height: 1.3;
`;

const CopyLogBtn = styled.button`
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ $copied, theme }) => $copied ? theme.green : theme.border};
  border-radius: ${({ theme }) => theme.radius};
  color: ${({ $copied, theme }) => $copied ? theme.green : theme.muted};
  cursor: pointer;
  font: 600 10px/1 inherit;
  padding: 3px 7px;
  flex-shrink: 0;

  &:hover {
    color: ${({ theme }) => theme.text};
    border-color: ${({ theme }) => theme.accent};
  }
`;

export default function DebugSection({
  rawMe,
  tickLog,
  etaDebugLog,
  etaDebugLogVersion,
  goalNagDebug,
  onCheckGoalNags,
}) {
  const [copyLabel, setCopyLabel] = useState('Copy');
  const [etaCopyLabel, setEtaCopyLabel] = useState('Copy');
  const [nagCopyLabel, setNagCopyLabel] = useState('Copy');
  const [nagCheckLabel, setNagCheckLabel] = useState('Check now');

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

  async function handleNagCopy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(goalNagDebug ?? null, null, 2));
      setNagCopyLabel('Copied!');
      setTimeout(() => setNagCopyLabel('Copy'), 1500);
    } catch {
      setNagCopyLabel('Error');
      setTimeout(() => setNagCopyLabel('Copy'), 1500);
    }
  }

  async function handleNagCheck() {
    setNagCheckLabel('Checking…');
    const result = await onCheckGoalNags?.();
    setNagCheckLabel(result?.ok ? `Checked ${result.checked}` : 'Check failed');
    setTimeout(() => setNagCheckLabel('Check now'), 2000);
  }

  return (
    <>
      <DebugDetails>
        <summary>Debug — raw <code>me</code> state</summary>
        <DebugMePre>{rawMe != null ? JSON.stringify(rawMe, null, 2) : ''}</DebugMePre>
      </DebugDetails>
      <DebugDetails>
        <summary>Debug — tick log</summary>
        <TickLogHeader>
          <TickLogHint>
            Newest first · <code>rd</code>=active ticks · <code>lb</code>=loot bag · <code>gen</code>=items · <code>bt</code>=bank trips · <code>cd</code>=ETA cycle dur · <code>od</code>=observed dur · <code>sm</code>=samples
            · <code>gr</code>/<code>rr</code>=goal/runout rate mode
          </TickLogHint>
          <CopyLogBtn $copied={copyLabel === 'Copied!'} onClick={handleCopy}>{copyLabel}</CopyLogBtn>
        </TickLogHeader>
        <DebugPre>{tickLogText}</DebugPre>
      </DebugDetails>
      <DebugDetails>
        <summary>Debug — ETA debug log</summary>
        <TickLogHeader>
          <TickLogHint>
            Newest first · JSON · v{etaDebugLogVersion ?? '?'} · captures ETA model, rate samples, bank projection, activity phase, and inventory deltas
          </TickLogHint>
          <CopyLogBtn $copied={etaCopyLabel === 'Copied!'} onClick={handleEtaCopy}>{etaCopyLabel}</CopyLogBtn>
        </TickLogHeader>
        <DebugPre>{etaDebugLogText}</DebugPre>
      </DebugDetails>
      <DebugDetails>
        <summary>Debug — goal reminders</summary>
        <TickLogHeader>
          <TickLogHint>
            Current completed-goal matching, scheduled alarms, and reminder lifecycle events
          </TickLogHint>
          <CopyLogBtn onClick={handleNagCheck}>{nagCheckLabel}</CopyLogBtn>
          <CopyLogBtn $copied={nagCopyLabel === 'Copied!'} onClick={handleNagCopy}>{nagCopyLabel}</CopyLogBtn>
        </TickLogHeader>
        <DebugPre id="goal-nag-debug-pre">
          {goalNagDebug != null
            ? JSON.stringify(goalNagDebug, null, 2)
            : '(goal reminder debug unavailable — reload the extension)'}
        </DebugPre>
      </DebugDetails>
    </>
  );
}
