import styled from 'styled-components';
import QueueStepLocationPicker from './QueueStepLocationPicker';
import QueueStepDropSourceRow from './QueueStepDropSourceRow';

// RowGroup owns the bottom border so both the main row and the sub-line
// share one divider. Row itself has no border.
const RowGroup = styled.div`
  border-bottom: 1px solid ${({ theme }) => theme.border};
  &:last-child { border-bottom: none; }
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  font-size: 12px;
`;

const Cell = styled.span`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: ${({ theme }) => theme.brown900};
`;

const StopText = styled.span`
  font-size: 10px;
  color: ${({ theme }) => theme.brown500};
  white-space: nowrap;
`;

function formatStop(stop) {
  if (!stop) return '';
  if (stop.kind === 'items') return `≥ ${stop.goal}`;
  if (stop.kind === 'indefinite') return '∞';
  if (stop.kind === 'actions') return `${stop.count}×`;
  if (stop.kind === 'kills') return `${stop.count} kills`;
  if (stop.kind === 'level') return `lv ${stop.level}`;
  return '';
}

export default function QueueStepRow({
  step,
  stepIndex,
  onSelectZone,
  writeZonePreference,
  onSelectDropSource,
  onSelectCombatSkill,
  playerCombatLevel,
  playerSkillLevels,
}) {
  const { goal, goalPlan, activityDefinition, skillId, zoneId, zoneCandidates, resolutionSource, error, isChanceBased } = step;

  function handleSelectZone(selectedZoneId) {
    onSelectZone(stepIndex, selectedZoneId);
    if (writeZonePreference) {
      if (isChanceBased) {
        // Use the selected monster's mob ID as the zone-preference entity key.
        const selectedCandidate = step.dropSourceCandidates?.find(
          c => c.activityId === step.selectedActivityId
        );
        writeZonePreference(step.selectedActivityId, selectedCandidate?.mobId, selectedZoneId);
      } else {
        writeZonePreference(goalPlan?.activityId, activityDefinition?.entity, selectedZoneId);
      }
    }
  }

  return (
    <RowGroup>
      <Row>
        <Cell title={goal?.itemName}>{goal?.itemName}</Cell>
        <QueueStepLocationPicker
          zoneId={zoneId}
          zoneCandidates={zoneCandidates}
          resolutionSource={resolutionSource}
          error={error}
          onSelect={handleSelectZone}
        />
        <StopText>{formatStop(goalPlan?.achievableTarget != null
          ? { kind: 'items', itemId: goal?.itemId, goal: goalPlan.achievableTarget }
          : { kind: 'items', itemId: goal?.itemId, goal: goal?.targetCount })}</StopText>
      </Row>
      {isChanceBased && (
        <QueueStepDropSourceRow
          step={step}
          stepIndex={stepIndex}
          onSelectDropSource={onSelectDropSource}
          onSelectCombatSkill={onSelectCombatSkill}
          playerCombatLevel={playerCombatLevel}
          playerSkillLevels={playerSkillLevels}
        />
      )}
    </RowGroup>
  );
}
