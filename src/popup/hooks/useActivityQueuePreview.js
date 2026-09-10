import { useState, useCallback, useMemo } from 'react';
import {
  buildActivityQueueSteps,
  activityQueueStepFromGoalPlan,
} from '../../queue-steps.js';
import { setGameQueue, cancelGameQueue } from '../utils/messages';
import useChromeStorageState from './useChromeStorageState';

// Owns the preview state for the Set Queue modal.
// Builds queue steps from the current goal statuses and tracks per-step zone
// overrides that the user picks in the modal. Confirm is disabled until every
// step has a resolved zone.
export default function useActivityQueuePreview({
  goalStatuses,
  activityDefs,
  skillByActivity,
  zoneDefinitions,
  learnedZonePreferences,
  currentZoneId,
}) {
  const [autoStart, setAutoStart] = useChromeStorageState(
    'queueAutoStart',
    false
  );
  const [zoneOverrides, setZoneOverrides] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { steps, skippedGoals } = useMemo(
    () =>
      buildActivityQueueSteps({
        goalStatuses: goalStatuses ?? [],
        activityDefs: activityDefs ?? {},
        skillByActivity: skillByActivity ?? {},
        zoneDefinitions: zoneDefinitions ?? {},
        learnedZonePreferences: learnedZonePreferences ?? {
          byActivityId: {},
          byEntityId: {},
        },
        currentZoneId: currentZoneId ?? null,
      }),
    [
      goalStatuses,
      activityDefs,
      skillByActivity,
      zoneDefinitions,
      learnedZonePreferences,
      currentZoneId,
    ]
  );

  const stepsWithOverrides = useMemo(
    () =>
      steps.map((step, index) => ({
        ...step,
        zoneId: zoneOverrides[index] ?? step.zoneId,
      })),
    [steps, zoneOverrides]
  );

  // Steps with empty candidates can't be resolved by the user — they're waiting
  // for zone data to load. Count them separately so the dialog can explain why.
  const waitingStepCount = stepsWithOverrides.filter(
    (s) =>
      !s.error &&
      s.zoneId == null &&
      (!s.zoneCandidates || s.zoneCandidates.length === 0)
  ).length;
  const unresolvedStepCount = stepsWithOverrides.filter(
    (s) =>
      !s.error &&
      s.zoneId == null &&
      s.zoneCandidates &&
      s.zoneCandidates.length > 0
  ).length;
  const errorStepCount = stepsWithOverrides.filter((s) => s.error).length;
  const canConfirm =
    unresolvedStepCount === 0 &&
    errorStepCount === 0 &&
    waitingStepCount === 0 &&
    stepsWithOverrides.length > 0;

  const setStepZone = useCallback((stepIndex, zoneId) => {
    setZoneOverrides((prev) => ({ ...prev, [stepIndex]: zoneId }));
  }, []);

  const confirm = useCallback(async () => {
    if (!canConfirm) return;
    const gameSteps = stepsWithOverrides
      .filter((s) => !s.error && s.zoneId != null)
      .map((s) =>
        activityQueueStepFromGoalPlan({
          goal: s.goal,
          goalPlan: s.goalPlan,
          activityDefinition: s.activityDefinition,
          skillId: s.skillId,
          zoneId: s.zoneId,
        })
      );
    setIsSubmitting(true);
    try {
      const result = await setGameQueue(gameSteps, autoStart);
      return result;
    } finally {
      setIsSubmitting(false);
    }
  }, [stepsWithOverrides, canConfirm, autoStart]);

  const resetOverrides = useCallback(() => setZoneOverrides({}), []);

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
    confirm,
    cancelSubmit,
    resetOverrides,
    isSubmitting,
  };
}
