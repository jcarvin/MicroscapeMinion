import { describe, expect, it } from 'vitest';
import {
  buildDropSourceCandidates,
  selectDefaultDropSource,
  formatDropChance,
  combatSkillOptionsForSource,
  computePlayerCombatLevel,
} from '../src/drop-sources.js';

// Synthetic XP table: level N requires N*100 XP (index = level).
const XP_TABLE = Array.from({ length: 100 }, (_, i) => i * 100);

const ZONE_DEFINITIONS = {
  swamp: { name: 'Swamp', mapPos: [1, 1], entities: ['giant-rat', 'skeleton'], isDungeon: false, requiredItem: null },
  sewer: { name: 'Sewer', mapPos: [5, 5], entities: ['giant-rat'], isDungeon: true, requiredItem: null },
  graveyard: { name: 'Graveyard', mapPos: [3, 3], entities: ['skeleton'], isDungeon: false, requiredItem: null },
  dungeon: { name: 'Dungeon', mapPos: [8, 8], entities: ['skeleton'], isDungeon: true, requiredItem: null },
  lockedArea: { name: 'Locked Area', mapPos: [2, 2], entities: ['scorpion'], isDungeon: false, requiredItem: 'key' },
};

const ACTIVITY_DEFS = {
  'fight-giant-rat': {
    mob: 'giant-rat', level: 1, xpPerCycle: 0, durationMs: 6000, inventoryChanges: {},
    name: 'giant rat',
    dropItems: { bones: 1, rawMeat: 1 },
    dropRarity: { bones: 1, rawMeat: 2 },
    mobCombatLevel: 3,
    mobMinimumCombatLevel: 0,
    mobRequiredItem: null,
    mobSafeSpot: false,
  },
  'fight-skeleton': {
    mob: 'skeleton', level: 5, xpPerCycle: 0, durationMs: 8000, inventoryChanges: {},
    name: 'skeleton',
    dropItems: { bones: 1 },
    dropRarity: { bones: 0 },
    mobCombatLevel: 8,
    mobMinimumCombatLevel: 0,
    mobRequiredItem: null,
    mobSafeSpot: false,
  },
  'fight-demon': {
    mob: 'demon', level: 60, xpPerCycle: 0, durationMs: 12000, inventoryChanges: {},
    name: 'demon',
    dropItems: { bones: 1 },
    dropRarity: { bones: 3 },
    mobCombatLevel: 50,
    mobMinimumCombatLevel: 40,
    mobRequiredItem: null,
    mobSafeSpot: false,
  },
  'fight-scorpion': {
    mob: 'scorpion', level: 20, xpPerCycle: 0, durationMs: 10000, inventoryChanges: {},
    name: 'scorpion',
    dropItems: { bones: 1 },
    dropRarity: { bones: 2 },
    mobCombatLevel: 15,
    mobMinimumCombatLevel: 0,
    mobRequiredItem: 'key',
    mobSafeSpot: false,
  },
  'fight-crocodile-safe': {
    mob: 'crocodile-safe', level: 30, xpPerCycle: 0, durationMs: 10000, inventoryChanges: {},
    name: 'crocodile',
    dropItems: { bones: 1 },
    dropRarity: { bones: 2 },
    mobCombatLevel: 20,
    mobMinimumCombatLevel: 0,
    mobRequiredItem: null,
    mobSafeSpot: true,
  },
  'forge-sword': {
    entity: 'anvil', level: 10, xpPerCycle: 50, durationMs: 20000, inventoryChanges: { ironBar: -1, ironSword: 1 },
    dropItems: {},
  },
};

const COMBAT_SKILLS = [
  { id: 'attack', name: 'Attack' },
  { id: 'strength', name: 'Strength' },
  { id: 'defense', name: 'Defense' },
  { id: 'evilMagic', name: 'Evil Magic' },
  { id: 'ranged', name: 'Ranged' },
];

describe('formatDropChance', () => {
  it('returns "always" for rarity 0', () => {
    expect(formatDropChance(0)).toBe('always');
  });

  it('returns "1 in N" for rarity > 0', () => {
    expect(formatDropChance(1)).toBe('1 in 2');
    expect(formatDropChance(3)).toBe('1 in 8');
    expect(formatDropChance(7)).toBe('1 in 128');
  });
});

describe('computePlayerCombatLevel', () => {
  it('computes combat level from attack/strength/defense', () => {
    // attack=10, strength=10, defense=5 → floor((10+5)/2) = 7
    const exp = { attack: 1000, strength: 1000, defense: 500 };
    const level = computePlayerCombatLevel(exp, XP_TABLE);
    expect(level).toBe(Math.floor(((10 + 10) / 2 + 5) / 2));
  });

  it('uses evilMagic when it beats (attack+strength)/2', () => {
    // attack=1, strength=1, defense=1, evilMagic=20
    const exp = { attack: 100, strength: 100, defense: 100, evilMagic: 2000 };
    const level = computePlayerCombatLevel(exp, XP_TABLE);
    expect(level).toBe(Math.floor((20 + 1) / 2));
  });

  it('returns null when attack is absent', () => {
    expect(computePlayerCombatLevel({ strength: 100, defense: 100 }, XP_TABLE)).toBeNull();
  });

  it('returns null when skillExp is null', () => {
    expect(computePlayerCombatLevel(null, XP_TABLE)).toBeNull();
  });
});

describe('buildDropSourceCandidates', () => {
  it('returns one candidate per fight activity that drops the item', () => {
    const candidates = buildDropSourceCandidates({
      itemId: 'bones',
      activityDefs: ACTIVITY_DEFS,
      zoneDefinitions: ZONE_DEFINITIONS,
      currentZoneId: null,
    });
    const ids = candidates.map(c => c.activityId);
    expect(ids).toContain('fight-giant-rat');
    expect(ids).toContain('fight-skeleton');
    expect(ids).toContain('fight-demon');
    expect(ids).toContain('fight-scorpion');
    expect(ids).not.toContain('forge-sword');
  });

  it('includes dungeon zones in zone candidates for mob lookup', () => {
    const candidates = buildDropSourceCandidates({
      itemId: 'bones',
      activityDefs: ACTIVITY_DEFS,
      zoneDefinitions: ZONE_DEFINITIONS,
      currentZoneId: null,
    });
    const rat = candidates.find(c => c.activityId === 'fight-giant-rat');
    const zoneIds = rat.zoneCandidates.map(z => z.zoneId);
    expect(zoneIds).toContain('swamp');
    expect(zoneIds).toContain('sewer'); // dungeon included
  });

  it('sets blockedReason requires-item for mobs with mobRequiredItem', () => {
    const candidates = buildDropSourceCandidates({
      itemId: 'bones',
      activityDefs: ACTIVITY_DEFS,
      zoneDefinitions: ZONE_DEFINITIONS,
      currentZoneId: null,
    });
    const scorpion = candidates.find(c => c.activityId === 'fight-scorpion');
    expect(scorpion.blockedReason).toBe('requires-item');
  });

  it('sets blockedReason null for mobs without a required item', () => {
    const candidates = buildDropSourceCandidates({
      itemId: 'bones',
      activityDefs: ACTIVITY_DEFS,
      zoneDefinitions: ZONE_DEFINITIONS,
      currentZoneId: null,
    });
    const rat = candidates.find(c => c.activityId === 'fight-giant-rat');
    expect(rat.blockedReason).toBeNull();
  });

  it('attaches dropChanceLabel from rarity', () => {
    const candidates = buildDropSourceCandidates({
      itemId: 'bones',
      activityDefs: ACTIVITY_DEFS,
      zoneDefinitions: ZONE_DEFINITIONS,
      currentZoneId: null,
    });
    const skeleton = candidates.find(c => c.activityId === 'fight-skeleton');
    expect(skeleton.dropChanceLabel).toBe('always');
    const rat = candidates.find(c => c.activityId === 'fight-giant-rat');
    expect(rat.dropChanceLabel).toBe('1 in 2');
  });
});

describe('selectDefaultDropSource', () => {
  it('returns null for empty candidates', () => {
    expect(selectDefaultDropSource({ candidates: [], playerCombatLevel: 10 })).toBeNull();
  });

  it('prefers unblocked candidate with lowest rarity', () => {
    const candidates = buildDropSourceCandidates({
      itemId: 'bones',
      activityDefs: ACTIVITY_DEFS,
      zoneDefinitions: ZONE_DEFINITIONS,
      currentZoneId: null,
    });
    // skeleton has rarity 0 (always) and is unblocked → should be selected
    const result = selectDefaultDropSource({ candidates, playerCombatLevel: 100 });
    expect(result.activityId).toBe('fight-skeleton');
  });

  it('excludes candidates above minimumCombatLevel', () => {
    // Player level 10: demon requires lv 40, so it should not be selected
    const candidates = buildDropSourceCandidates({
      itemId: 'bones',
      activityDefs: ACTIVITY_DEFS,
      zoneDefinitions: ZONE_DEFINITIONS,
      currentZoneId: null,
    }).filter(c => c.activityId !== 'fight-scorpion' && c.activityId !== 'fight-crocodile-safe');
    const result = selectDefaultDropSource({ candidates, playerCombatLevel: 10 });
    expect(result.activityId).not.toBe('fight-demon');
  });

  it('falls back to unblocked candidate with lowest mobCombatLevel when all are over-level', () => {
    // Only demon available (blocked by level), no unblocked below-level option
    const demonOnly = [{
      activityId: 'fight-demon',
      activityName: 'demon',
      mobId: 'demon',
      rarity: 3,
      dropChanceLabel: '1 in 8',
      mobCombatLevel: 50,
      mobMinimumCombatLevel: 40,
      mobRequiredItem: null,
      mobSafeSpot: false,
      blockedReason: null,
      zoneCandidates: [],
    }];
    const result = selectDefaultDropSource({ candidates: demonOnly, playerCombatLevel: 5 });
    expect(result.activityId).toBe('fight-demon');
  });

  it('skips level filtering when playerCombatLevel is null', () => {
    const candidates = buildDropSourceCandidates({
      itemId: 'bones',
      activityDefs: ACTIVITY_DEFS,
      zoneDefinitions: ZONE_DEFINITIONS,
      currentZoneId: null,
    });
    // Should still find a result (skeleton with rarity 0)
    const result = selectDefaultDropSource({ candidates, playerCombatLevel: null });
    expect(result).not.toBeNull();
    expect(result.activityId).toBe('fight-skeleton');
  });
});

describe('combatSkillOptionsForSource', () => {
  it('returns all combat skills for non-safeSpot mobs', () => {
    const candidate = { mobId: 'giant-rat', mobSafeSpot: false };
    const result = combatSkillOptionsForSource(candidate, COMBAT_SKILLS);
    expect(result).toHaveLength(5);
  });

  it('excludes melee skills for safeSpot mobs', () => {
    const candidate = { mobId: 'croc-safe', mobSafeSpot: true };
    const result = combatSkillOptionsForSource(candidate, COMBAT_SKILLS);
    const ids = result.map(s => s.id);
    expect(ids).not.toContain('attack');
    expect(ids).not.toContain('strength');
    expect(ids).not.toContain('defense');
    expect(ids).toContain('evilMagic');
    expect(ids).toContain('ranged');
  });

  it('returns empty array when combatSkills is null', () => {
    expect(combatSkillOptionsForSource({ mobId: 'rat', mobSafeSpot: false }, null)).toEqual([]);
  });

  it('returns empty array for skill (non-combat) activities', () => {
    expect(combatSkillOptionsForSource({ mobId: null, mobSafeSpot: false }, COMBAT_SKILLS)).toEqual([]);
  });
});
