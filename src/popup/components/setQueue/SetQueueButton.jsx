import styled from 'styled-components';

const StyledButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  padding: 0 8px;
  font-size: 10px;
  background: ${({ theme }) => theme.parchment};
  border: 2px solid ${({ theme }) => theme.brown700};
  border-radius: ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.brown900};
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.2);
  white-space: nowrap;
  &:hover { background: ${({ theme }) => theme.parchmentLight}; }
  &:active {
    transform: translateY(1px);
    box-shadow: none;
  }
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    pointer-events: none;
  }
`;

export default function SetQueueButton({ isMember, connected, onClick }) {
  if (!isMember) return null;
  return (
    <StyledButton
      type="button"
      disabled={!connected}
      title={connected ? 'Set activity queue from goals' : 'Not connected'}
      onClick={onClick}
    >
      Set Queue
    </StyledButton>
  );
}
