import { formatTickEntry } from '../../utils/format';
import useTransientLabel from '../../hooks/useTransientLabel';
import { CopyLogBtn, DebugDetails, DebugPre, PanelHeader, PanelHint } from './DebugSection.styles';

export default function TickLogPanel({ tickLog }) {
  const [copyLabel, flash] = useTransientLabel('Copy', 1500);

  const tickLogText = tickLog?.length
    ? tickLog.map(formatTickEntry).join('\n')
    : '(no ticks yet)';

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(tickLog, null, 2));
      flash('Copied!');
    } catch {
      flash('Error');
    }
  }

  return (
    <DebugDetails>
      <summary>Debug — tick log</summary>
      <PanelHeader>
        <PanelHint>
          Newest first · <code>rd</code>=active ticks · <code>lb</code>=loot bag · <code>gen</code>=items · <code>bt</code>=bank trips · <code>cd</code>=ETA cycle dur · <code>od</code>=observed dur · <code>sm</code>=samples
          · <code>gr</code>/<code>rr</code>=goal/runout rate mode
        </PanelHint>
        <CopyLogBtn onClick={handleCopy}>{copyLabel}</CopyLogBtn>
      </PanelHeader>
      <DebugPre>{tickLogText}</DebugPre>
    </DebugDetails>
  );
}
