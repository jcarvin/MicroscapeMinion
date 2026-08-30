import styled from 'styled-components';

export const Card = styled.section`
  padding: 10px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.border};
  &:last-child { border-bottom: none; }
`;

export const CardLabel = styled.div`
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .07em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.muted};
  margin-bottom: 6px;
`;

export const EtaGroup = styled.span`
  display: inline-flex;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 4px;
  min-width: 0;
`;

export const EtaLabel = styled.span`
  color: ${({ theme }) => theme.muted};
`;

export const EtaStack = styled.span`
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.2;
  text-align: right;
`;

export const ToggleTrack = styled.span`
  position: absolute;
  inset: 0;
  background: ${({ theme }) => theme.border};
  border-radius: 99px;
  transition: background 0.2s;

  &::after {
    content: '';
    position: absolute;
    left: 2px;
    top: 2px;
    width: 10px;
    height: 10px;
    background: ${({ theme }) => theme.muted};
    border-radius: 50%;
    transition: transform 0.15s, background 0.15s;
  }
`;

export const ToggleSwitch = styled.span`
  position: relative;
  width: 26px;
  height: 14px;
  flex-shrink: 0;

  input {
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  }

  input:checked + ${ToggleTrack} {
    background: ${({ theme }) => theme.accent};
  }

  input:checked + ${ToggleTrack}::after {
    transform: translateX(12px);
    background: #fff;
  }
`;

export const NotifyLabel = styled.label`
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  font-size: 11px;
  color: ${({ theme }) => theme.muted};
  user-select: none;
  &:hover { color: ${({ theme }) => theme.text}; }
`;
