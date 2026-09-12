// Translates goal-tracker rows into activity queue steps.
//
// Each step follows the game's `{ type, zone, skill, activity, stop }` shape.
// Stop condition is always `{ kind:'items', itemId, goal, op:'gte' }` because
// `me.inventory[itemId] >= goal` matches the same field the extension already
// tracks for goal completion — no conversion, no drift across bank trips.
//
// Goals are included only when:
//   - goalPlan.activityId is set (has a concrete activity recommendation)
//   - goal is not completed, not pending, and not singleExecution
//   - goal.itemId is present (needed for the items stop condition)
//
// Chance-based (Drops) goals build a combat step with the best available
// monster as the default. The modal lets the user change monster and combat
// skill before confirming.
//
// Zone resolution is delegated to zone-resolver.js. Steps with unresolved
// zones are returned with zoneId: null and their candidates so the modal can
// ask. Zero candidates is a hard error surfaced as "location data unavailable".

import { inferActivitySkill } from './goal-planner.js';
import { findZoneCandidatesForEntity, resolveZoneForActivity } from './zone-resolver.js';
import {
  buildDropSourceCandidates,
  selectDefaultDropSource,
  combatSkillOptionsForSource,
} from './drop-sources.js';

export function activityQueueStepFromGoalPlan({
  goal,
  goalPlan,
  activityDefinition,
  skillId,
  zoneId,
  activityId,
}) {
  const isCombat = Boolean(activityDefinition?.mob);
  const resolvedActivityId = activityId ?? goalPlan.activityId;
  const stop = {
    kind: 'items',
    itemId: goal.itemId,
    goal: goalPlan.achievableTarget ?? goal.targetCount,
    op: 'gte',
  };

  if (isCombat) {
    return { type: 'combat', zone: zoneId, combatSkill: skillId, activity: resolvedActivityId, stop };
  }
  return { type: 'skill', zone: zoneId, skill: skillId, activity: resolvedActivityId, stop };
}

export function buildActivityQueueSteps({
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
  const steps = [];
  const skippedGoals = [];

  for (const { goal, planning: goalPlan } of goalStatuses ?? []) {
    if (!goalPlan?.activityId) {
      skippedGoals.push({ goal, reason: 'no-activity' });
      continue;
    }
    if (goal.completed) {
      skippedGoals.push({ goal, reason: 'completed' });
      continue;
    }
    if (goalPlan.pending) {
      skippedGoals.push({ goal, reason: 'pending' });
      continue;
    }
    if (!goal.itemId) {
      skippedGoals.push({ goal, reason: 'no-item-id' });
      continue;
    }

    // Chance-based (drops) goals: build a combat step with drop source selection.
    if (goalPlan.chanceBased === true) {
      const dropSourceCandidates = buildDropSourceCandidates({
        itemId: goal.itemId,
        activityDefs,
        zoneDefinitions,
        currentZoneId,
        skillByActivity,
      });

      if (dropSourceCandidates.length === 0) {
        skippedGoals.push({ goal, reason: 'no-activity' });
        continue;
      }

      const defaultSource = selectDefaultDropSource({ candidates: dropSourceCandidates, playerCombatLevel });
      const selectedActivityId = defaultSource?.activityId ?? null;
      const activityDefinition = selectedActivityId ? (activityDefs?.[selectedActivityId] ?? null) : null;

      const skillOptions = combatSkillOptionsForSource(defaultSource, combatSkills ?? []);
      const preferredSkill = combatSkillPreference ?? skillOptions[0]?.id ?? null;
      const combatSkillId = skillOptions.some(s => s.id === preferredSkill)
        ? preferredSkill
        : (skillOptions[0]?.id ?? null);

      const entityId = defaultSource?.entityId ?? null;
      const zoneCandidates = defaultSource?.zoneCandidates ?? [];

      const { zoneId, resolutionSource } = resolveZoneForActivity({
        entityId,
        activityId: selectedActivityId,
        currentZoneId,
        learnedZonePreferences,
        zoneCandidates,
      });

      steps.push({
        goal,
        goalPlan,
        activityDefinition,
        skillId: combatSkillId,
        zoneId,
        resolutionSource,
        zoneCandidates,
        isChanceBased: true,
        dropSourceCandidates,
        selectedActivityId,
        combatSkillId,
        combatSkillOptions: skillOptions,
      });
      continue;
    }

    const activityId = goalPlan.activityId;
    const activityDefinition = activityDefs?.[activityId] ?? null;

    if (activityDefinition?.singleExecution) {
      skippedGoals.push({ goal, reason: 'single-execution' });
      continue;
    }

    // Skill resolution: parsed index is authoritative; definition field and
    // prefix heuristic are last resorts for activities the index missed.
    const skillId =
      skillByActivity?.[activityId] ??
      activityDefinition?.skill ??
      inferActivitySkill(activityId) ??
      null;

    const entityId = activityDefinition?.entity ?? null;

    let zoneCandidates;
    if (!entityId) {
      // No entity means no zone data for this activity.
      zoneCandidates = [];
    } else {
      zoneCandidates = findZoneCandidatesForEntity({
        entityId,
        zoneDefinitions,
        currentZoneId,
      });
    }

    if (entityId && zoneCandidates.length === 0) {
      const zoneDataLoaded = zoneDefinitions && Object.keys(zoneDefinitions).length > 0;
      if (zoneDataLoaded) {
        // Hard error: zone data is present but this entity has no accessible zone.
        // Likely a parser regression — surface it rather than silently skipping.
        steps.push({
          goal,
          goalPlan,
          activityDefinition,
          skillId,
          zoneId: null,
          resolutionSource: 'no-candidates',
          zoneCandidates: [],
          error: 'location data unavailable',
        });
        continue;
      }
      // Zone data not loaded yet — fall through as unresolved with empty candidates.
    }

    const { zoneId, resolutionSource } = resolveZoneForActivity({
      entityId,
      activityId,
      currentZoneId,
      learnedZonePreferences,
      zoneCandidates,
    });

    steps.push({
      goal,
      goalPlan,
      activityDefinition,
      skillId,
      zoneId,
      resolutionSource,
      zoneCandidates,
    });
  }

  return { steps, skippedGoals };
}
