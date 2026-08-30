import useTransientLabel from '../../hooks/useTransientLabel';
import { CopyLogBtn, DebugDetails, DebugMePre, PanelHeader, PanelHint } from './DebugSection.styles';

export default function RawStatePanel({ rawMe }) {
  const [copyLabel, flash] = useTransientLabel('Copy', 1500);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(rawMe ?? null, null, 2));
      flash('Copied!');
    } catch {
      flash('Error');
    }
  }

  return (
    <DebugDetails>
      <summary>Debug — raw <code>me</code> state</summary>
      <PanelHeader>
        <PanelHint>Raw game state snapshot</PanelHint>
        <CopyLogBtn onClick={handleCopy}>{copyLabel}</CopyLogBtn>
      </PanelHeader>
      <DebugMePre>{rawMe != null ? JSON.stringify(rawMe, null, 2) : ''}</DebugMePre>
    </DebugDetails>
  );
}
