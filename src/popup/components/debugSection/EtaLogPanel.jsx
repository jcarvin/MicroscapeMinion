import useTransientLabel from '../../hooks/useTransientLabel';
import { CopyLogBtn, DebugDetails, DebugPre, PanelHeader, PanelHint } from './DebugSection.styles';

export default function EtaLogPanel({ etaDebugLog, etaDebugLogVersion }) {
  const [copyLabel, flash] = useTransientLabel('Copy', 1500);

  const etaDebugAvailable = Array.isArray(etaDebugLog);
  const etaDebugLogText = !etaDebugAvailable
    ? '(ETA debug log unavailable from background — reload the extension)'
    : etaDebugLog.length
    ? `${etaDebugLog.length} ETA debug entries captured. Use Copy to export full JSON.`
    : '(no ETA debug entries yet)';

  async function handleCopy() {
    try {
      const payload = etaDebugAvailable
        ? etaDebugLog
        : {
            error: 'eta-debug-log-unavailable',
            etaDebugLogVersion,
            message: 'GET_STATUS did not include etaDebugLog. Reload the extension background service worker.',
          };
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      flash('Copied!');
    } catch {
      flash('Error');
    }
  }

  return (
    <DebugDetails>
      <summary>Debug — ETA debug log</summary>
      <PanelHeader>
        <PanelHint>
          Newest first · JSON · v{etaDebugLogVersion ?? '?'} · captures ETA model, rate samples, bank projection, activity phase, and inventory deltas
        </PanelHint>
        <CopyLogBtn onClick={handleCopy}>{copyLabel}</CopyLogBtn>
      </PanelHeader>
      <DebugPre>{etaDebugLogText}</DebugPre>
    </DebugDetails>
  );
}
