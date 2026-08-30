import { useEffect, useId, useRef, useState } from 'react';
import styled from 'styled-components';

const TOOLTIP_DELAY_MS = 150;

export const GOAL_SOURCE_OPTIONS = [
  {
    id: 'any',
    label: 'Any',
    description: 'Use any acquisition route (including purchasing). Materials and XP are not projected.',
  },
  {
    id: 'manual',
    label: 'Manual',
    description: 'Assumes manual gathering (e.g., mining). Shows ETA and XP projections.',
  },
  {
    id: 'craft',
    label: 'Craft',
    description: 'Plan recipe materials, level requirements, and deterministic XP. Enables Max.',
  },
  {
    id: 'drops',
    label: 'Drops',
    description: 'Assumes fighting a monster that drops the item. ETA from calibrated drop rate. XP not projected.',
  },
];

const GoalSourceLabel = styled.span`
  color: ${({ theme }) => theme.muted};
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: .04em;
`;

const GoalSourceOptions = styled.div`
  display: inline-flex;
`;

const GoalSourceBtn = styled.button`
  background: transparent;
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: 0;
  color: ${({ theme }) => theme.muted};
  font-size: 9px;
  line-height: 1;
  padding: 3px 6px;

  & + & { border-left: 0; }
  &:first-child { border-radius: ${({ theme }) => theme.radius} 0 0 ${({ theme }) => theme.radius}; }
  &:last-child { border-radius: 0 ${({ theme }) => theme.radius} ${({ theme }) => theme.radius} 0; }

  &[aria-pressed="true"] {
    background: rgba(91, 141, 238, .18);
    border-color: ${({ theme }) => theme.accent};
    color: ${({ theme }) => theme.text};
  }

  &:focus-visible {
    position: relative;
    z-index: 1;
    outline: 1px solid ${({ theme }) => theme.accent};
    outline-offset: 1px;
  }
`;

const GoalSourceTooltip = styled.span`
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  z-index: 100;
  width: 216px;
  max-width: calc(100vw - 24px);
  padding: 7px 8px;
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.tooltipBg};
  color: ${({ theme }) => theme.text};
  box-shadow: 0 6px 16px rgba(0,0,0,.45);
  font-size: 11px;
  font-weight: 400;
  line-height: 1.35;
  pointer-events: none;
`;

export const GoalSourceWrap = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 4px 24px 0 22px;
`;

export default function GoalSourceSelector({ value, onChange, options = GOAL_SOURCE_OPTIONS, delayMs = TOOLTIP_DELAY_MS }) {
  const tooltipId = useId();
  const showTimerRef = useRef(null);
  const [helpMode, setHelpMode] = useState(null);

  function clearShowTimer() {
    if (showTimerRef.current === null) return;
    clearTimeout(showTimerRef.current);
    showTimerRef.current = null;
  }

  function showHelp(mode) {
    clearShowTimer();
    showTimerRef.current = setTimeout(() => {
      showTimerRef.current = null;
      setHelpMode(mode);
    }, delayMs);
  }

  function hideHelp() {
    clearShowTimer();
    setHelpMode(null);
  }

  useEffect(() => clearShowTimer, []);

  const activeHelp = options.find(({ id }) => id === helpMode) ?? null;

  return (
    <GoalSourceWrap onMouseLeave={hideHelp}>
      <GoalSourceLabel>Source</GoalSourceLabel>
      <GoalSourceOptions role="group" aria-label="Goal acquisition source">
        {options.map((option) => (
          <GoalSourceBtn
            type="button"
            key={option.id}
            aria-label={`${option.label} source. ${option.description}`}
            aria-pressed={value === option.id}
            aria-describedby={helpMode === option.id ? tooltipId : undefined}
            onClick={() => onChange(option.id)}
            onMouseEnter={() => showHelp(option.id)}
            onFocus={() => showHelp(option.id)}
            onBlur={hideHelp}
          >
            {option.label}
          </GoalSourceBtn>
        ))}
      </GoalSourceOptions>
      {activeHelp && (
        <GoalSourceTooltip id={tooltipId} role="tooltip">
          {activeHelp.description}
        </GoalSourceTooltip>
      )}
    </GoalSourceWrap>
  );
}
