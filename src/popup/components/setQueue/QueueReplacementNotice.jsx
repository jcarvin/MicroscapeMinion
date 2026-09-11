import styled from 'styled-components';

const Notice = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.amber};
  padding: 4px 0;
`;

export default function QueueReplacementNotice({ existingStepCount, isRunning }) {
  if (existingStepCount === 0 && !isRunning) return null;
  return (
    <Notice>
      {isRunning && <div>The active queue will be stopped first.</div>}
      {existingStepCount > 0 && (
        <div>{existingStepCount} existing step{existingStepCount !== 1 ? 's' : ''} will be cleared.</div>
      )}
    </Notice>
  );
}
