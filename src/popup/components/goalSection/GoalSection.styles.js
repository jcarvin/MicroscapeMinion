import styled, { css, keyframes } from 'styled-components';
import { CardLabel } from '../Shared';
import { ComboWrap } from '../ItemCombobox';
import { GoalSourceWrap } from '../GoalSourceSelector';

export const goalDropPulse = keyframes`
  from { opacity: .55; transform: scaleX(.96); }
  to { opacity: 1; transform: scaleX(1); }
`;

export const GoalPlanNote = styled.div`
  margin: 4px 24px 0 22px;
  color: ${({ theme }) => theme.brown500};
  font-size: 10px;
`;

export const GoalIconBtnBase = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  line-height: 1;
  background: transparent;
  border: none;
  box-shadow: none;
`;

export const GoalDragBtn = styled(GoalIconBtnBase)`
  color: ${({ theme }) => theme.brown500};
  width: 18px;
  cursor: grab;
  font-size: 10px;
  letter-spacing: 0;
  &:active { cursor: grabbing; }
  &:hover { color: ${({ theme }) => theme.brown900}; background: transparent; }
`;

export const GoalDragColumn = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
`;

export const GoalCollapseBtn = styled.button`
  background: transparent;
  border: none;
  box-shadow: none;
  color: ${({ theme }) => theme.brown500};
  width: 18px;
  height: 12px;
  padding: 0;
  font-size: 9px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.18s ease, color 0.15s;
  transform: rotate(${({ $collapsed }) => ($collapsed ? '-90deg' : '0deg')});
  &:hover { color: ${({ theme }) => theme.brown900}; filter: none; background: transparent; }
  &:active { transform: rotate(${({ $collapsed }) => ($collapsed ? '-90deg' : '0deg')}) translateY(0); box-shadow: none; }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

export const GoalTargetControl = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;

  input {
    width: 100%;
    border-radius: 0 ${({ theme }) => theme.radius} ${({ theme }) => theme.radius} 0;
  }

  input:first-child {
    border-radius: ${({ theme }) => theme.radius};
  }

  input[readonly] {
    color: ${({ theme }) => theme.brown700};
    cursor: default;
  }
`;

export const GoalRow = styled.div`
  position: relative;
  background: linear-gradient(180deg, ${({ theme }) => theme.parchmentLight}, ${({ theme }) => theme.parchment});
  border: 3px solid ${({ theme }) => theme.parchmentDark};
  border-radius: 3px;
  box-shadow:
    inset 0 0 0 2px rgba(255,239,195,0.4),
    inset 0 -3px 0 rgba(98,60,25,0.12),
    3px 3px 0 rgba(0,0,0,0.24);
  color: ${({ theme }) => theme.brown900};
  padding: 6px;
  transition: box-shadow 140ms ease, border-color 140ms ease, opacity 140ms ease, transform 140ms ease;

  ${({ $isCurrent }) => $isCurrent && css`
    border-color: #4a7e28;
    box-shadow:
      inset 0 0 0 2px rgba(78,133,41,0.35),
      inset 0 -3px 0 rgba(98,60,25,0.12),
      3px 3px 0 rgba(0,0,0,0.24);
  `}

  ${({ $isInfeasible, theme }) => $isInfeasible && css`
    border-color: rgba(212,63,42,0.8);
    box-shadow:
      inset 0 0 0 2px rgba(212,63,42,0.2),
      inset 0 -3px 0 rgba(98,60,25,0.12),
      3px 3px 0 rgba(0,0,0,0.24);
    ${GoalPlanNote} { color: ${theme.red}; }
  `}

  ${({ $isCompleted }) => $isCompleted && css`
    opacity: .45;
    ${GoalDragBtn}, ${ComboWrap}, ${GoalTargetControl}, ${GoalSourceWrap} {
      pointer-events: none;
    }
  `}

  ${({ $isDragging }) => $isDragging && css`
    opacity: .35;
    transform: scale(.985);
  `}

  ${({ $dropBefore, theme }) => $dropBefore && css`
    transform: translateY(2px);
    &::before {
      content: '';
      position: absolute;
      left: 0; right: 0; top: -6px;
      z-index: 2;
      height: 2px;
      border-radius: 2px;
      background: ${theme.accent};
      box-shadow: 0 0 0 1px rgba(78,133,41,0.2), 0 0 7px rgba(78,133,41,0.65);
      animation: ${goalDropPulse} 650ms ease-in-out infinite alternate;
      pointer-events: none;
    }
  `}

  ${({ $dropAfter, theme }) => $dropAfter && css`
    transform: translateY(-2px);
    &::after {
      content: '';
      position: absolute;
      left: 0; right: 0; bottom: -6px;
      z-index: 2;
      height: 2px;
      border-radius: 2px;
      background: ${theme.accent};
      box-shadow: 0 0 0 1px rgba(78,133,41,0.2), 0 0 7px rgba(78,133,41,0.65);
      animation: ${goalDropPulse} 650ms ease-in-out infinite alternate;
      pointer-events: none;
    }
  `}

  @media (prefers-reduced-motion: reduce) {
    transition: none;
    &::before, &::after { animation: none; }
  }
`;

export const GoalRowDivider = styled.div`
  position: relative;
  height: 1px;
  background: ${({ theme }) => theme.border};
  transition: background 0.15s;
  &:hover { background: transparent; }
`;

export const GoalInsertBtn = styled.button`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  background: ${({ theme }) => theme.panel};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: 50%;
  box-shadow: none;
  color: ${({ theme }) => theme.muted};
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, border-color 0.15s;

  ${GoalRowDivider}:hover & {
    opacity: 1;
    color: ${({ theme }) => theme.brown900};
    border-color: ${({ theme }) => theme.gold};
  }

  &:active {
    transform: translate(-50%, -50%);
    box-shadow: none;
  }
`;

export const GoalAddBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  line-height: 1;
  font-size: 17px;
  background: ${({ theme }) => theme.parchment};
  border: 2px solid ${({ theme }) => theme.brown700};
  border-radius: ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.brown900};
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.2);
  &:hover { background: ${({ theme }) => theme.parchmentLight}; }
  &:active {
    transform: translateY(1px);
    box-shadow: none;
  }
`;

export const GoalRemoveBtn = styled(GoalIconBtnBase)`
  color: ${({ theme }) => theme.brown500};
  font-size: 18px;
  &:hover { color: ${({ theme }) => theme.red}; background: transparent; }
  &:active { transform: none; box-shadow: none; }
`;

export const GoalHeading = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;

  ${CardLabel} { margin-bottom: 0; }
`;

export const GoalList = styled.div`
  display: grid;
  gap: 9px;
  padding-bottom: 8px;
`;

export const GoalRowFields = styled.div`
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 92px 20px;
  align-items: center;
  gap: 4px;
`;

export const GoalMaxBtn = styled.button`
  align-self: stretch;
  background: ${({ theme }) => theme.parchment};
  border: 2px solid ${({ theme }) => theme.brown700};
  border-right: 0;
  border-radius: ${({ theme }) => theme.radius} 0 0 ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.brown700};
  font-size: 9px;
  padding: 0 4px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);

  &[aria-pressed="true"] {
    background: ${({ theme }) => theme.accent};
    border-color: #1d4316;
    color: ${({ theme }) => theme.text};
    box-shadow: inset 0 2px 0 rgba(255,255,255,0.1);
  }
  &:hover { background: ${({ theme }) => theme.parchmentLight}; }
  &[aria-pressed="true"]:hover { background: #3d6e1c; }
  &:active {
    transform: translateY(1px);
    box-shadow: none;
  }
`;

export const GoalStatus = styled.div`
  margin: 5px 24px 0 22px;
`;

export const ProgressBarWrap = styled.div`
  height: 12px;
  background: #78572e;
  border: 2px solid #60401e;
  border-radius: 0;
  overflow: hidden;
  padding: 2px;
  margin-bottom: 5px;
  box-shadow: inset 0 2px 0 rgba(0,0,0,0.2);
`;

export const ProgressBar = styled.div`
  height: 100%;
  background: ${({ theme }) => theme.accent};
  border-radius: 0;
  width: 0%;
  transition: width 0.4s;
  box-shadow: inset 0 2px 0 rgba(255,255,255,0.14);
`;

export const ProgressLabel = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  font-size: 11px;
  color: ${({ theme }) => theme.brown700};
`;

export const ProgressCounts = styled.span`
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
`;

export const ProgressDivider = styled.span`
  flex-shrink: 0;
  width: 1px;
  align-self: stretch;
  position: relative;

  &::after {
    content: '';
    position: absolute;
    left: 0;
    top: 10%;
    bottom: 10%;
    width: 1px;
    background: ${({ theme }) => theme.parchmentDark};
  }
`;

export const GoalLevelProjection = styled.div`
  margin: 3px 24px 0 22px;
  color: ${({ theme }) => theme.brown500};
  font-size: 10px;
`;
