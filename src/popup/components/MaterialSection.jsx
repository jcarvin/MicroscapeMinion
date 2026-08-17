import { formatItemId, formatNumber } from '../utils/format';
import EtaDisplay from './EtaDisplay';
import EtaTooltip from './EtaTooltip';

export default function MaterialSection({ runoutStatus, selectedSkillEta, xpPerCycle }) {
  if (!runoutStatus) return null;

  const rs = runoutStatus;
  const label  = rs.itemId ? `${formatItemId(rs.itemId)}: ` : '';
  const cycles = rs.cyclesLeft != null ? `${rs.cyclesLeft}` : `${rs.totalMaterial} remaining`;
  const etaMs  = rs.etaMs > 0 ? rs.etaMs : 0;

  let levelGoalLine = null;
  if (selectedSkillEta && xpPerCycle > 0 && rs.costPerCycle > 0) {
    const cyclesNeeded = Math.ceil(selectedSkillEta.xpNeeded / xpPerCycle);
    const materialNeeded = cyclesNeeded * rs.costPerCycle;
    const shortage = materialNeeded - rs.totalMaterial;
    const itemLabel = rs.itemId ? formatItemId(rs.itemId) : 'material';
    if (shortage > 0) {
      levelGoalLine = `Need ${formatNumber(shortage)} more ${itemLabel} for Lv ${selectedSkillEta.targetLevel}`;
    } else {
      levelGoalLine = `Enough ${itemLabel} for Lv ${selectedSkillEta.targetLevel}`;
    }
  }

  return (
    <section className="card">
      <div className="card-label">Material Runout</div>
      <div className="runout-row">
        <span>{label}{cycles}</span>
        <span className="eta-group">
          <EtaDisplay etaMs={etaMs} doneLabel="Out now" warmupRemainingMs={rs.warmupRemainingMs ?? 0} />
          <EtaTooltip />
        </span>
      </div>
      {levelGoalLine && (
        <div className="runout-level-goal">{levelGoalLine}</div>
      )}
    </section>
  );
}
