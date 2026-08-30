import { useState } from 'react';
import useTransientLabel from '../../hooks/useTransientLabel';
import { CopyLogBtn, DebugDetails, DebugPre, PanelHeader, PanelHint } from './DebugSection.styles';

export default function NagPanel({ goalNagDebug, onCheckGoalNags }) {
  const [copyLabel, flashCopy] = useTransientLabel('Copy', 1500);
  const [checkLabel, flashCheck] = useTransientLabel('Check now', 2000);
  const [checking, setChecking] = useState(false);

  async function handleNagCheck() {
    setChecking(true);
    const result = await onCheckGoalNags?.();
    setChecking(false);
    flashCheck(result?.ok ? `Checked ${result.checked}` : 'Check failed');
  }

  async function handleNagCopy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(goalNagDebug ?? null, null, 2));
      flashCopy('Copied!');
    } catch {
      flashCopy('Error');
    }
  }

  return (
    <DebugDetails>
      <summary>Debug — goal reminders</summary>
      <PanelHeader>
        <PanelHint>
          Current completed-goal matching, scheduled alarms, and reminder lifecycle events
        </PanelHint>
        <CopyLogBtn onClick={handleNagCheck} disabled={checking}>{checking ? 'Checking…' : checkLabel}</CopyLogBtn>
        <CopyLogBtn onClick={handleNagCopy}>{copyLabel}</CopyLogBtn>
      </PanelHeader>
      <DebugPre id="goal-nag-debug-pre">
        {goalNagDebug != null
          ? JSON.stringify(goalNagDebug, null, 2)
          : '(goal reminder debug unavailable — reload the extension)'}
      </DebugPre>
    </DebugDetails>
  );
}
