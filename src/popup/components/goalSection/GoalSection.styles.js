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
  color: ${({ theme }) => theme.muted};
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
`;

export const GoalDragBtn = styled(GoalIconBtnBase)`
  background: transparent;
  color: ${({ theme }) => theme.muted};
  width: 18px;
  cursor: grab;
  font-size: 10px;
  letter-spacing: 0;
  &:active { cursor: grabbing; }
  &:hover { color: ${({ theme }) => theme.text}; }
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
    color: ${({ theme }) => theme.muted};
    cursor: default;
  }
`;

export const GoalRow = styled.div`
  position: relative;
  border-radius: ${({ theme }) => theme.radius};
  transition: background 140ms ease, box-shadow 140ms ease, opacity 140ms ease, transform 140ms ease;

  ${({ $isCurrent }) => $isCurrent && css`
    background: rgba(91, 141, 238, .06);
    box-shadow: 0 0 0 4px rgba(91, 141, 238, .06);
  `}

  ${({ $isInfeasible, theme }) => $isInfeasible && css`
    background: rgba(248, 113, 113, .08);
    box-shadow: 0 0 0 4px rgba(248, 113, 113, .08), 0 0 10px rgba(248, 113, 113, .12);
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
      box-shadow: 0 0 0 1px rgba(91,141,238,.2), 0 0 7px rgba(91,141,238,.65);
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
      box-shadow: 0 0 0 1px rgba(91,141,238,.2), 0 0 7px rgba(91,141,238,.65);
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
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: 50%;
  color: ${({ theme }) => theme.muted};
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, border-color 0.15s;

  ${GoalRowDivider}:hover & {
    opacity: 1;
    color: ${({ theme }) => theme.accent};
    border-color: ${({ theme }) => theme.accent};
  }
`;

export const GoalAddBtn = styled(GoalIconBtnBase)`
  font-size: 17px;
`;

export const GoalRemoveBtn = styled(GoalIconBtnBase)`
  background: transparent;
  color: ${({ theme }) => theme.muted};
  font-size: 18px;
  &:hover { color: ${({ theme }) => theme.text}; }
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
`;

export const GoalRowFields = styled.div`
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 92px 20px;
  align-items: center;
  gap: 4px;
`;

export const GoalMaxBtn = styled.button`
  align-self: stretch;
  background: transparent;
  border: 1px solid ${({ theme }) => theme.border};
  border-right: 0;
  border-radius: ${({ theme }) => theme.radius} 0 0 ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.muted};
  font-size: 9px;
  padding: 0 4px;

  &[aria-pressed="true"] {
    background: ${({ theme }) => theme.accent};
    border-color: ${({ theme }) => theme.accent};
    color: #fff;
  }
`;

export const GoalStatus = styled.div`
  margin: 5px 24px 0 22px;
`;

export const ProgressBarWrap = styled.div`
  height: 5px;
  background: ${({ theme }) => theme.border};
  border-radius: 99px;
  overflow: hidden;
  margin-bottom: 5px;
`;

export const ProgressBar = styled.div`
  height: 100%;
  background: ${({ theme }) => theme.accent};
  border-radius: 99px;
  width: 0%;
  transition: width 0.4s;
`;

export const ProgressLabel = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  font-size: 11px;
  color: ${({ theme }) => theme.muted};
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
    background: ${({ theme }) => theme.border};
  }
`;

export const GoalLevelProjection = styled.div`
  margin: 3px 24px 0 22px;
  color: ${({ theme }) => theme.muted};
  font-size: 10px;
`;
