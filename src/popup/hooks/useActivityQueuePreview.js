import { useState, useCallback, useMemo } from 'react';
import {
  buildActivityQueueSteps,
  activityQueueStepFromGoalPlan,
} from '../../queue-steps.js';
import { combatSkillOptionsForSource } from '../../drop-sources.js';
import { resolveZoneForActivity } from '../../zone-resolver.js';
import { setGameQueue, cancelGameQueue } from '../utils/messages';
import useChromeStorageState from './useChromeStorageState';

// Owns the preview state for the Set Queue modal.
// Builds queue steps from the current goal statuses and tracks per-step
// zone, drop-source, and combat-skill overrides the user picks in the modal.
export default function useActivityQueuePreview({
  goalStatuses,
  activityDefs,
  skillByActivity,
  zoneDefinitions,
  learnedZonePreferences,
  currentZoneId,
  combatSkills,
  combatSkillPreference,
  playerCombatLevel,
}) {
  const [autoStart, setAutoStart] = useChromeStorageState('queueAutoStart', false);
  const [zoneOverrides, setZoneOverrides] = useState({});
  const [dropSourceOverrides, setDropSourceOverrides] = useState({});
  const [combatSkillOverrides, setCombatSkillOverrides] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { steps, skippedGoals } = useMemo(
    () =>
      buildActivityQueueSteps({
        goalStatuses: goalStatuses ?? [],
        activityDefs: activityDefs ?? {},
        skillByActivity: skillByActivity ?? {},
        zoneDefinitions: zoneDefinitions ?? {},
        learnedZonePreferences: learnedZonePreferences ?? { byActivityId: {}, byEntityId: {} },
        currentZoneId: currentZoneId ?? null,
        combatSkills: combatSkills ?? [],
        combatSkillPreference: combatSkillPreference ?? null,
        playerCombatLevel: playerCombatLevel ?? null,
      }),
    [
      goalStatuses,
      activityDefs,
      skillByActivity,
      zoneDefinitions,
      learnedZonePreferences,
      currentZoneId,
      combatSkills,
      combatSkillPreference,
      playerCombatLevel,
    ]
  );

  const stepsWithOverrides = useMemo(() => {
    return steps.map((step, index) => {
      const zoneOverride = zoneOverrides[index];

      if (!step.isChanceBased) {
        return { ...step, zoneId: zoneOverride ?? step.zoneId };
      }

      // For chance steps: apply drop-source override, recompute zone candidates,
      // then apply zone override on top.
      const selectedActivityId = dropSourceOverrides[index] ?? step.selectedActivityId;
      const selectedCandidate = step.dropSourceCandidates?.find(
        c => c.activityId === selectedActivityId
      ) ?? null;

      const zoneCandidates = selectedCandidate?.zoneCandidates ?? step.zoneCandidates;

      let zoneId = zoneOverride ?? null;
      let resolutionSource = 'override';
      if (zoneId === null) {
        const resolved = resolveZoneForActivity({
          entityId: selectedCandidate?.entityId ?? null,
          activityId: selectedActivityId,
          currentZoneId: currentZoneId ?? null,
          learnedZonePreferences: learnedZonePreferences ?? { byActivityId: {}, byEntityId: {} },
          zoneCandidates,
        });
        zoneId = resolved.zoneId;
        resolutionSource = resolved.resolutionSource;
      }

      const skillOptions = selectedCandidate
        ? combatSkillOptionsForSource(selectedCandidate, combatSkills ?? [])
        : (step.combatSkillOptions ?? []);
      const defaultSkillId = combatSkillPreference ?? skillOptions[0]?.id ?? null;
      const combatSkillId = combatSkillOverrides[index] ?? (
        skillOptions.some(s => s.id === defaultSkillId)
          ? defaultSkillId
          : (skillOptions[0]?.id ?? null)
      );
      // For skill drop sources (fishing etc.) use the activity's own skill, not combat skill.
      const effectiveSkillId = combatSkillId ?? skillByActivity?.[selectedActivityId] ?? null;

      return {
        ...step,
        selectedActivityId,
        activityDefinition: selectedActivityId ? (activityDefs?.[selectedActivityId] ?? null) : null,
        combatSkillId,
        combatSkillOptions: skillOptions,
        skillId: effectiveSkillId,
        zoneCandidates,
        zoneId,
        resolutionSource,
      };
    });
  }, [
    steps,
    zoneOverrides,
    dropSourceOverrides,
    combatSkillOverrides,
    combatSkills,
    combatSkillPreference,
    currentZoneId,
    learnedZonePreferences,
    activityDefs,
  ]);

  const waitingStepCount = stepsWithOverrides.filter(
    s => !s.error && s.zoneId == null && (!s.zoneCandidates || s.zoneCandidates.length === 0)
  ).length;
  const unresolvedStepCount = stepsWithOverrides.filter(
    s => !s.error && s.zoneId == null && s.zoneCandidates && s.zoneCandidates.length > 0
  ).length;
  const errorStepCount = stepsWithOverrides.filter(s => s.error).length;

  const allChanceStepsReady = stepsWithOverrides
    .filter(s => s.isChanceBased)
    .every(s => s.selectedActivityId != null &&
      (s.combatSkillOptions?.length === 0 || s.combatSkillId != null));

  const canConfirm =
    unresolvedStepCount === 0 &&
    errorStepCount === 0 &&
    waitingStepCount === 0 &&
    allChanceStepsReady &&
    stepsWithOverrides.length > 0;

  const setStepZone = useCallback((stepIndex, zoneId) => {
    setZoneOverrides(prev => ({ ...prev, [stepIndex]: zoneId }));
  }, []);

  const setStepDropSource = useCallback((stepIndex, activityId) => {
    setDropSourceOverrides(prev => ({ ...prev, [stepIndex]: activityId }));
    // Clear zone override when monster changes so zone re-resolves for the new mob.
    setZoneOverrides(prev => { const next = { ...prev }; delete next[stepIndex]; return next; });
  }, []);

  const setStepCombatSkill = useCallback((stepIndex, skillId) => {
    setCombatSkillOverrides(prev => ({ ...prev, [stepIndex]: skillId }));
  }, []);

  const confirm = useCallback(async () => {
    if (!canConfirm) return;
    const gameSteps = stepsWithOverrides
      .filter(s => !s.error && s.zoneId != null)
      .map(s =>
        activityQueueStepFromGoalPlan({
          goal: s.goal,
          goalPlan: s.goalPlan,
          activityDefinition: s.activityDefinition,
          skillId: s.skillId,
          zoneId: s.zoneId,
          activityId: s.isChanceBased ? s.selectedActivityId : undefined,
        })
      );
    setIsSubmitting(true);
    try {
      return await setGameQueue(gameSteps, autoStart);
    } finally {
      setIsSubmitting(false);
    }
  }, [stepsWithOverrides, canConfirm, autoStart]);

  const resetOverrides = useCallback(() => {
    setZoneOverrides({});
    setDropSourceOverrides({});
    setCombatSkillOverrides({});
  }, []);

  const cancelSubmit = useCallback(() => {
    cancelGameQueue();
    setIsSubmitting(false);
  }, []);

  return {
    steps: stepsWithOverrides,
    skippedGoals,
    unresolvedStepCount,
    waitingStepCount,
    canConfirm,
    autoStart,
    setAutoStart,
    setStepZone,
    setStepDropSource,
    setStepCombatSkill,
    confirm,
    cancelSubmit,
    resetOverrides,
    isSubmitting,
  };
}
