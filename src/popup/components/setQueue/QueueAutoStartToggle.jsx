import styled from 'styled-components';

const Label = styled.label`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: ${({ theme }) => theme.brown700};
  cursor: pointer;
  user-select: none;
`;

export default function QueueAutoStartToggle({ autoStart, onChange }) {
  return (
    <Label>
      <input
        type="checkbox"
        checked={autoStart}
        onChange={e => onChange(e.target.checked)}
      />
      Start queue immediately
    </Label>
  );
}
