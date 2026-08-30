import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { formatSkillName, formatNumber } from '../utils/format';
import { setSkillNotify, clearSkillNotify } from '../utils/messages';
import { Card, CardLabel, EtaGroup } from './Shared';
import EtaDisplay from './EtaDisplay';
import EtaTooltip from './EtaTooltip';
import SkillNotifyToggleSection from './SkillNotifyToggleSection';
import useChromeStorageState from '../hooks/useChromeStorageState';

const SKILL_LEVEL_SELECTIONS_KEY = 'skillLevelSelections';

const SkillSliderRow = styled.div`
  display: grid;
  gap: 2px;
  margin-bottom: 6px;
`;

const SkillSlider = styled.input`
  width: 100%;
  height: 16px;
  accent-color: ${({ theme }) => theme.accent};
  background: transparent;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;

  &::-webkit-slider-runnable-track {
    height: 4px;
    background: ${({ theme }) => theme.border};
    border-radius: 99px;
  }

  &::-webkit-slider-thumb {
    width: 14px;
    height: 14px;
    margin-top: -5px;
    background: ${({ theme }) => theme.accent};
    border: 2px solid ${({ theme }) => theme.text};
    border-radius: 50%;
    cursor: pointer;
    -webkit-appearance: none;
  }

  &::-moz-range-track {
    height: 4px;
    background: ${({ theme }) => theme.border};
    border-radius: 99px;
  }

  &::-moz-range-thumb {
    width: 14px;
    height: 14px;
    background: ${({ theme }) => theme.accent};
    border: 2px solid ${({ theme }) => theme.text};
    border-radius: 50%;
    cursor: pointer;
  }
`;

const SkillNotchLabels = styled.div`
  display: flex;
  justify-content: space-between;
  color: ${({ theme }) => theme.muted};
  font-size: 9px;
  line-height: 1;
  padding: 0 2px;
  user-select: none;
`;

const SkillXpEtaRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
`;

function resolveOffset(xs, maxOffset, savedTargetLevel, currentOffset) {
  if (savedTargetLevel != null) {
    if (savedTargetLevel <= xs.currentLevel) return 1;
    const idx = xs.etas.findIndex(eta => eta.targetLevel === savedTargetLevel) + 1;
    if (idx >= 1 && idx <= maxOffset) return idx;
  }
  return Math.min(Math.max(1, currentOffset), maxOffset);
}

export default function SkillSection({ skillLevelStatus, skillNotifyTarget, onSelectedEtaChange }) {
  const [selectedLevelOffset, setSelectedLevelOffset] = useState(1);
  const [savedSelections, setSavedSelections] = useChromeStorageState(SKILL_LEVEL_SELECTIONS_KEY, {});

  const xs   = skillLevelStatus;
  const etas = xs?.etas ?? [];

  const maxOffset      = Math.min(10, etas.length) || 1;
  const savedTarget    = xs?.skill ? ((savedSelections ?? {})[xs.skill] ?? null) : null;
  const clampedOffset  = etas.length > 0
    ? resolveOffset(xs, maxOffset, savedTarget, selectedLevelOffset)
    : 1;

  const notchLabels = useMemo(
    () => Array.from({ length: etas.length > 0 ? maxOffset : 0 }, (_, i) => `+${i + 1}`),
    [maxOffset, etas.length]
  );

  const eta = etas.length > 0 ? etas[clampedOffset - 1] : null;

  useEffect(() => {
    onSelectedEtaChange?.(eta ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eta?.targetLevel]);

  if (!etas.length) return null;

  function handleSliderChange(e) {
    const newOffset = parseInt(e.target.value, 10) || 1;
    setSelectedLevelOffset(newOffset);
    const newEta = xs?.etas?.[newOffset - 1];
    if (xs?.skill && newEta?.targetLevel) {
      setSavedSelections({ ...savedSelections, [xs.skill]: newEta.targetLevel });
    }
  }

  const isNotifyChecked = !!(
    skillNotifyTarget &&
    skillNotifyTarget.skill === xs.skill &&
    skillNotifyTarget.level === eta.targetLevel
  );

  function handleNotifyChange(checked) {
    if (checked) setSkillNotify(xs.skill, eta.targetLevel);
    else         clearSkillNotify();
  }

  return (
    <Card>
      <CardLabel>
        Skill XP — {formatSkillName(xs.skill)} Lv {xs.currentLevel}
      </CardLabel>
      <SkillSliderRow>
        <SkillSlider
          type="range"
          min="1"
          max={maxOffset}
          step="1"
          value={clampedOffset}
          onChange={handleSliderChange}
        />
        <SkillNotchLabels>
          {notchLabels.map(label => <span key={label}>{label}</span>)}
        </SkillNotchLabels>
      </SkillSliderRow>
      <SkillXpEtaRow>
        <span>→ Lv {eta.targetLevel} ({formatNumber(eta.xpNeeded)} XP)</span>
        <EtaGroup>
          <EtaDisplay
            etaMs={eta.etaMs ?? null}
            bankTrips={eta.bankTrips ?? 0}
            doneLabel="Now"
            warmupRemainingMs={eta.warmupRemainingMs ?? 0}
          />
          <EtaTooltip />
        </EtaGroup>
      </SkillXpEtaRow>
      <SkillNotifyToggleSection
        targetLevel={eta.targetLevel}
        checked={isNotifyChecked}
        onChange={handleNotifyChange}
      />
    </Card>
  );
}
