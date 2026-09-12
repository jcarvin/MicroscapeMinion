import styled from 'styled-components';
import PortalSelect from './PortalSelect';

const SubRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0 4px 8px;
  font-size: 11px;
  color: ${({ theme }) => theme.brown700};
`;

const Label = styled.span`
  color: ${({ theme }) => theme.brown500};
  flex-shrink: 0;
`;

// Indented sub-line for chance-based (drop) queue steps.
// Lets the user pick which monster to fight and which combat skill to train.
export default function QueueStepDropSourceRow({
  step,
  stepIndex,
  onSelectDropSource,
  onSelectCombatSkill,
  playerCombatLevel,
  playerSkillLevels,
}) {
  const { dropSourceCandidates, selectedActivityId, combatSkillId, combatSkillOptions } = step;

  const sourceOptions = (dropSourceCandidates ?? []).map((candidate) => {
    const isCombatCandidate = candidate.mobId != null;
    const isRequiresItem = candidate.blockedReason === 'requires-item';
    const isRequiresLevel =
      candidate.mobMinimumCombatLevel > 0 &&
      playerCombatLevel != null &&
      candidate.mobMinimumCombatLevel > playerCombatLevel;

    const playerSkillLevel = candidate.skillId ? (playerSkillLevels?.[candidate.skillId] ?? null) : null;
    const isUnderSkillLevel =
      candidate.activityLevel > 0 &&
      playerSkillLevel != null &&
      playerSkillLevel < candidate.activityLevel;

    let hint;
    let hintWarn = false;
    const chanceLabel = candidate.dropChanceLabel ?? null;
    if (isCombatCandidate) {
      if (isRequiresItem) { hint = `needs ${candidate.mobRequiredItem}`; hintWarn = true; }
      else if (isRequiresLevel) { hint = `needs lv ${candidate.mobMinimumCombatLevel}`; hintWarn = true; }
      else if (candidate.mobCombatLevel != null)
        hint = chanceLabel != null ? `${chanceLabel} · lv ${candidate.mobCombatLevel}` : `lv ${candidate.mobCombatLevel}`;
      else hint = chanceLabel ?? undefined;
    } else {
      if (isUnderSkillLevel) hintWarn = true;
      if (candidate.activityLevel > 0)
        hint = chanceLabel != null ? `${chanceLabel} · lv ${candidate.activityLevel}` : `lv ${candidate.activityLevel}`;
      else hint = chanceLabel ?? undefined;
    }

    return {
      value: candidate.activityId,
      label: candidate.activityName,
      disabled: isRequiresItem || isRequiresLevel,
      hint,
      hintWarn,
    };
  });

  const skillOptions = (combatSkillOptions ?? []).map((s) => ({
    value: s.id,
    label: s.name,
  }));

  const selectedCandidate = dropSourceCandidates?.find(c => c.activityId === selectedActivityId);
  const isCombatSource = selectedCandidate?.mobId != null;
  const sourceTriggerLabel = selectedCandidate?.activityName ?? '…';

  const selectedSkill = skillOptions.find(s => s.value === combatSkillId);
  const skillTriggerLabel = selectedSkill?.label ?? '…';

  return (
    <SubRow>
      {isCombatSource && (
        <>
          <Label>focus</Label>
          <PortalSelect
            options={skillOptions}
            value={combatSkillId}
            onSelect={(v) => onSelectCombatSkill(stepIndex, v)}
            placeholder="…"
            triggerLabel={skillTriggerLabel}
          />
        </>
      )}
      <Label>{isCombatSource ? 'fight' : 'source'}</Label>
      <PortalSelect
        options={sourceOptions}
        value={selectedActivityId}
        onSelect={(v) => onSelectDropSource(stepIndex, v)}
        placeholder="…"
        triggerLabel={sourceTriggerLabel}
      />
    </SubRow>
  );
}
