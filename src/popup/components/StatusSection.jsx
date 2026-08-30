import styled from 'styled-components';
import { Card, CardLabel } from './Shared';

const StatusRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
`;

const StatusBadge = styled.span`
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme, $status }) =>
    $status === 'idle' ? theme.amber :
    $status === 'active' ? theme.green :
    theme.text};
`;

const TickRate = styled.span`
  font-size: 10px;
  color: ${({ theme }) => theme.muted};
`;

export default function StatusSection({ connected, idle, activity, tickMs }) {
  let badge, status, tickText;

  if (!connected) {
    badge = 'Not connected'; status = null; tickText = '';
  } else if (idle) {
    badge = 'IDLE'; status = 'idle'; tickText = '';
  } else if (activity) {
    badge = activity; status = 'active'; tickText = `${tickMs}ms tick`;
  } else {
    badge = 'Observing…'; status = null; tickText = '';
  }

  return (
    <Card>
      <CardLabel>Status</CardLabel>
      <StatusRow>
        <StatusBadge $status={status} data-status={status}>{badge}</StatusBadge>
        <TickRate>{tickText}</TickRate>
      </StatusRow>
    </Card>
  );
}
