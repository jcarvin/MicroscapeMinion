import EtaDisplay from './EtaDisplay';
import EtaTooltip from './EtaTooltip';

export default function MaterialSection({ runoutStatus }) {
  if (!runoutStatus) return null;

  const rs = runoutStatus;
  const label  = rs.itemId ? `${rs.itemId}: ` : '';
  const cycles = rs.cyclesLeft != null ? `${rs.cyclesLeft}` : `${rs.totalMaterial} remaining`;
  const etaMs  = rs.etaMs > 0 ? rs.etaMs : 0;

  return (
    <section className="card">
      <div className="card-label">Material Runout</div>
      <div className="runout-row">
        <span>{label}{cycles}</span>
        <span className="eta-group">
          <EtaDisplay etaMs={etaMs} doneLabel="Out now" />
          <EtaTooltip />
        </span>
      </div>
    </section>
  );
}
