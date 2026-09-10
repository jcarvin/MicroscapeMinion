import styled from 'styled-components';
import QueueStepLocationPicker from './QueueStepLocationPicker';

const Row = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border-bottom: 1px solid ${({ theme }) => theme.border};
  &:last-child { border-bottom: none; }
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

export default function QueueStepRow({ step, stepIndex, onSelectZone, writeZonePreference }) {
  const { goal, goalPlan, activityDefinition, skillId, zoneId, zoneCandidates, resolutionSource, error } = step;

  function handleSelectZone(selectedZoneId) {
    onSelectZone(stepIndex, selectedZoneId);
    if (writeZonePreference) {
      writeZonePreference(goalPlan?.activityId, activityDefinition?.entity, selectedZoneId);
    }
  }

  return (
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
  );
}
