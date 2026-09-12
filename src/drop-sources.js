// Candidate construction and selection logic for drop-sourced queue steps.
//
// A "drop source" is a fight activity whose dropItems includes the goal item.
// The user picks which monster to farm; zone resolution follows from that choice.

import { findZoneCandidatesForEntity } from './zone-resolver.js';

const MELEE_SKILL_IDS = new Set(['attack', 'strength', 'defense']);

export function formatDropChance(rarity) {
  if (rarity === 0) return 'always';
  return `1 in ${Math.pow(2, rarity)}`;
}

// Formula from live bundle:
//   player combat level = floor((max((attack+strength)/2, evilMagic, ranged) + defense) / 2)
// Returns null when any contributing skill XP is absent (callers skip level filtering).
export function computePlayerCombatLevel(skillExp, xpTable) {
  if (!skillExp || !xpTable) return null;

  function expToLevel(exp) {
    for (let lvl = xpTable.length - 1; lvl >= 1; lvl--) {
      if ((xpTable[lvl] ?? 0) <= exp) return lvl;
    }
    return 1;
  }

  const attack = skillExp.attack != null ? expToLevel(skillExp.attack) : null;
  const strength = skillExp.strength != null ? expToLevel(skillExp.strength) : null;
  const defense = skillExp.defense != null ? expToLevel(skillExp.defense) : null;
  if (attack === null || strength === null || defense === null) return null;

  const evilMagic = skillExp.evilMagic != null ? expToLevel(skillExp.evilMagic) : 1;
  const ranged = skillExp.ranged != null ? expToLevel(skillExp.ranged) : 1;
  const offensivePart = Math.max((attack + strength) / 2, evilMagic, ranged);
  return Math.floor((offensivePart + defense) / 2);
}

// Builds one entry per activity (combat or skill) whose dropItems contains itemId.
// Combat zone lookup uses includeDungeonZones:true; skill activities don't restrict zones.
// All candidates carry entityId for zone resolution (= mobId for combat, entity for skill).
export function buildDropSourceCandidates({ itemId, activityDefs, zoneDefinitions, currentZoneId, skillByActivity }) {
  const candidates = [];
  for (const [activityId, def] of Object.entries(activityDefs ?? {})) {
    if (!def.dropItems?.[itemId]) continue;

    const rarity = def.dropRarity?.[itemId] ?? 0;

    if (def.mob) {
      // Combat activity
      const mobId = def.mob;
      const zoneCandidates = findZoneCandidatesForEntity({
        entityId: mobId,
        zoneDefinitions,
        currentZoneId,
        includeDungeonZones: true,
      });
      // 'requires-item': mob requires a specific held item (game's IK check).
      // 'requires-level': mob's minimumCombatLevel exceeds the player's level —
      //   computed at selection time in selectDefaultDropSource.
      const blockedReason = def.mobRequiredItem ? 'requires-item' : null;
      candidates.push({
        activityId,
        activityName: def.name ?? activityId,
        mobId,
        entityId: mobId,
        isCombat: true,
        skillId: null,
        activityLevel: 0,
        quantity: def.dropItems[itemId],
        rarity,
        dropChanceLabel: formatDropChance(rarity),
        mobCombatLevel: def.mobCombatLevel ?? null,
        mobMinimumCombatLevel: def.mobMinimumCombatLevel ?? 0,
        mobRequiredItem: def.mobRequiredItem ?? null,
        mobSafeSpot: def.mobSafeSpot ?? false,
        blockedReason,
        zoneCandidates,
      });
    } else if (def.entity) {
      // Skill activity (fishing, etc.) with rare drops
      const entityId = def.entity;
      const zoneCandidates = findZoneCandidatesForEntity({
        entityId,
        zoneDefinitions,
        currentZoneId,
        includeDungeonZones: false,
      });
      candidates.push({
        activityId,
        activityName: def.name ?? activityId.replace(/-/g, ' '),
        mobId: null,
        entityId,
        isCombat: false,
        skillId: skillByActivity?.[activityId] ?? null,
        activityLevel: def.level ?? 0,
        quantity: def.dropItems[itemId],
        rarity,
        dropChanceLabel: formatDropChance(rarity),
        mobCombatLevel: null,
        mobMinimumCombatLevel: 0,
        mobRequiredItem: null,
        mobSafeSpot: false,
        blockedReason: null,
        zoneCandidates,
      });
    }
  }
  return candidates;
}

// Selects the best default fight source for a drop goal.
// Among unblocked candidates at or below the player's combat level:
//   lowest rarity → nearest zone → activityId (stable tiebreak).
// Falls back to unblocked candidate with the lowest mob combat level when
// everything is over the player's level. Returns null when no candidates.
export function selectDefaultDropSource({ candidates, playerCombatLevel }) {
  if (!candidates || candidates.length === 0) return null;

  const unblocked = candidates.filter(c => c.blockedReason === null);
  if (unblocked.length === 0) return candidates[0] ?? null;

  function isLevelOk(c) {
    if (playerCombatLevel == null) return true;
    if (c.mobMinimumCombatLevel > 0 && c.mobMinimumCombatLevel > playerCombatLevel) return false;
    if (c.mobCombatLevel != null && c.mobCombatLevel > playerCombatLevel) return false;
    return true;
  }

  const eligible = unblocked.filter(isLevelOk);
  const pool = eligible.length > 0 ? eligible : unblocked;

  return pool.slice().sort((a, b) => {
    if (a.rarity !== b.rarity) return a.rarity - b.rarity;
    const da = a.zoneCandidates[0]?.distance ?? Infinity;
    const db = b.zoneCandidates[0]?.distance ?? Infinity;
    if (da !== db) return da - db;
    return a.activityId < b.activityId ? -1 : 1;
  })[0];
}

// Returns combat skills available for the given source.
// Skill (non-combat) activities return an empty list — no combat skill to choose.
// Combat mobs with safeSpot restrict to ranged and evilMagic only.
export function combatSkillOptionsForSource(candidate, combatSkills) {
  if (!candidate?.mobId) return []; // skill activity or no candidate
  if (!candidate.mobSafeSpot) return combatSkills ?? [];
  return (combatSkills ?? []).filter(s => !MELEE_SKILL_IDS.has(s.id));
}
