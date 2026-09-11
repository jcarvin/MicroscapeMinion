import styled from 'styled-components';

const Wrap = styled.div`
  font-size: 10px;
  color: ${({ theme }) => theme.brown500};
  border-top: 1px solid ${({ theme }) => theme.border};
  padding-top: 6px;
  margin-top: 4px;
`;

const SkipRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 1px 0;
`;

const REASON_LABELS = {
  'no-activity':      'no activity planned',
  'chance-based':     'drops goal (not queueable)',
  'completed':        'already completed',
  'pending':          'pending materials',
  'no-item-id':       'item ID unknown',
  'single-execution': 'single-use activity',
};

export default function QueueSkippedGoalList({ skippedGoals }) {
  if (!skippedGoals || skippedGoals.length === 0) return null;
  return (
    <Wrap>
      <div style={{ marginBottom: 3 }}>Skipped:</div>
      {skippedGoals.map(({ goal, reason }, i) => (
        <SkipRow key={goal.id ?? i}>
          <span>{goal.itemName}</span>
          <span>{REASON_LABELS[reason] ?? reason}</span>
        </SkipRow>
      ))}
    </Wrap>
  );
}
