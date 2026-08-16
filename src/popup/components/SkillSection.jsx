import { useState, useMemo } from 'react';
import { formatSkillName, formatNumber } from '../utils/format';
import { setSkillNotify, clearSkillNotify } from '../utils/messages';
import EtaDisplay from './EtaDisplay';
import EtaTooltip from './EtaTooltip';
import SkillNotifyToggleSection from './SkillNotifyToggleSection';

export default function SkillSection({ skillLevelStatus, skillNotifyTarget }) {
  const [selectedLevelOffset, setSelectedLevelOffset] = useState(1);

  const xs   = skillLevelStatus;
  const etas = xs?.etas ?? [];

  // All hooks before the conditional return
  const maxOffset    = Math.min(10, etas.length) || 1;
  const clampedOffset = Math.min(Math.max(1, selectedLevelOffset), maxOffset);

  const notchLabels = useMemo(
    () => Array.from({ length: etas.length > 0 ? maxOffset : 0 }, (_, i) => `+${i + 1}`),
    [maxOffset, etas.length]
  );

  if (!etas.length) return null;

  const eta = etas[clampedOffset - 1];

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
    <section className="card">
      <div className="card-label">
        Skill XP — {formatSkillName(xs.skill)} Lv {xs.currentLevel}
      </div>
      <div className="skill-xp-slider-row">
        <input
          type="range"
          id="skill-level-slider"
          min="1"
          max={maxOffset}
          step="1"
          value={clampedOffset}
          onChange={e => setSelectedLevelOffset(parseInt(e.target.value, 10) || 1)}
        />
        <div className="skill-xp-notch-labels">
          {notchLabels.map(label => <span key={label}>{label}</span>)}
        </div>
      </div>
      <div className="skill-xp-eta-row">
        <span>→ Lv {eta.targetLevel} ({formatNumber(eta.xpNeeded)} XP)</span>
        <span className="eta-group">
          <EtaDisplay etaMs={eta.etaMs ?? null} doneLabel="Now" />
          <EtaTooltip />
        </span>
      </div>
      <SkillNotifyToggleSection
        targetLevel={eta.targetLevel}
        checked={isNotifyChecked}
        onChange={handleNotifyChange}
      />
    </section>
  );
}
