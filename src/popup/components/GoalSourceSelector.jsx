import { useEffect, useId, useRef, useState } from 'react';

const TOOLTIP_DELAY_MS = 150;

export const GOAL_SOURCE_OPTIONS = [
  {
    id: 'any',
    label: 'Any',
    description: 'Use any acquisition route. Materials and XP are not projected.',
  },
  {
    id: 'craft',
    label: 'Craft',
    description: 'Plan recipe materials, level requirements, and deterministic XP. Enables Max.',
  },
  {
    id: 'drops',
    label: 'Drops',
    description: 'Treat the goal as chance-based drops. Max and XP projections are disabled.',
  },
];

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

  const activeHelp = GOAL_SOURCE_OPTIONS.find(({ id }) => id === helpMode) ?? null;

  return (
    <div className="goal-source-selector" onMouseLeave={hideHelp}>
      <span className="goal-source-label">Source</span>
      <div className="goal-source-options" role="group" aria-label="Goal acquisition source">
        {options.map((option) => (
          <button
            type="button"
            className="goal-source-btn"
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
          </button>
        ))}
      </div>
      {activeHelp && (
        <span className="goal-source-tooltip" id={tooltipId} role="tooltip">
          {activeHelp.description}
        </span>
      )}
    </div>
  );
}
