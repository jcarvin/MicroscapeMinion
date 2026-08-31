import styled from 'styled-components';

export const SectionWrapper = styled.section`
  padding: 10px 10px 0;
`;

export const Card = styled.div`
  background: linear-gradient(180deg, ${({ theme }) => theme.parchmentLight}, ${({ theme }) => theme.parchment});
  border: 3px solid ${({ theme }) => theme.parchmentDark};
  border-radius: 3px;
  box-shadow:
    inset 0 0 0 2px rgba(255,239,195,0.4),
    inset 0 -3px 0 rgba(98,60,25,0.12),
    3px 3px 0 rgba(0,0,0,0.28);
  color: ${({ theme }) => theme.brown900};
  padding: 8px 10px;
  margin-top: 6px;
  margin-bottom: 8px;
`;

export const CardLabel = styled.div`
  font-family: 'Pixelify Sans', monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.text};
  margin-bottom: 0;
`;

export const EtaGroup = styled.span`
  display: inline-flex;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 4px;
  min-width: 0;
`;

export const EtaLabel = styled.span`
  color: ${({ theme }) => theme.brown500};
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
  background: ${({ theme }) => theme.brown500};
  border-radius: 99px;
  transition: background 0.2s;

  &::after {
    content: '';
    position: absolute;
    left: 2px;
    top: 2px;
    width: 10px;
    height: 10px;
    background: ${({ theme }) => theme.parchmentLight};
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
  color: ${({ theme }) => theme.brown500};
  user-select: none;
  &:hover { color: ${({ theme }) => theme.brown900}; }
`;
