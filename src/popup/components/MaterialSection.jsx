import styled from 'styled-components';
import { formatItemId, formatNumber } from '../utils/format';
import { Card, CardLabel, EtaGroup, SectionWrapper } from './Shared';
import EtaDisplay from './EtaDisplay';
import EtaTooltip from './EtaTooltip';

const RunoutRow = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 12px;
`;

const RunoutLevelGoal = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.brown500};
  margin-top: 4px;
`;

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
    <SectionWrapper>
      <CardLabel>Material Runout</CardLabel>
      <Card>
        <RunoutRow>
          <span>{label}{cycles}</span>
          <EtaGroup>
            <EtaDisplay etaMs={etaMs} doneLabel="Out now" warmupRemainingMs={rs.warmupRemainingMs ?? 0} />
            <EtaTooltip />
          </EtaGroup>
        </RunoutRow>
        {levelGoalLine && (
          <RunoutLevelGoal>{levelGoalLine}</RunoutLevelGoal>
        )}
      </Card>
    </SectionWrapper>
  );
}
