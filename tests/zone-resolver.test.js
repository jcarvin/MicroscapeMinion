import { describe, expect, it } from 'vitest';
import {
  findZoneCandidatesForEntity,
  resolveZoneForActivity,
} from '../src/zone-resolver.js';

// Synthetic zone definitions — no real zone IDs, counts, or coordinates.
const ZONE_DEFINITIONS = {
  townSquare: { name: 'Town Square', mapPos: [5, 5], entities: ['fire', 'anvil'], isDungeon: false, requiredItem: null },
  northKitchen: { name: 'North Kitchen', mapPos: [5, 2], entities: ['fire'], isDungeon: false, requiredItem: null },
  workshop: { name: 'Workshop', mapPos: [3, 5], entities: ['anvil', 'loom'], isDungeon: false, requiredItem: null },
  dungeonForge: { name: 'Dungeon Forge', mapPos: [1, 1], entities: ['anvil'], isDungeon: true, requiredItem: null },
  secretLab: { name: 'Secret Lab', mapPos: [9, 9], entities: ['loom'], isDungeon: false, requiredItem: 'keycard' },
  soleWell: { name: 'Sole Well', mapPos: [6, 6], entities: ['well'], isDungeon: false, requiredItem: null },
};

describe('findZoneCandidatesForEntity', () => {
  it('returns all non-dungeon non-required-item zones that host the entity', () => {
    const candidates = findZoneCandidatesForEntity({
      entityId: 'fire',
      zoneDefinitions: ZONE_DEFINITIONS,
      currentZoneId: null,
    });
    const ids = candidates.map(c => c.zoneId);
    expect(ids).toContain('townSquare');
    expect(ids).toContain('northKitchen');
  });

  it('excludes dungeon zones', () => {
    const candidates = findZoneCandidatesForEntity({
      entityId: 'anvil',
      zoneDefinitions: ZONE_DEFINITIONS,
      currentZoneId: null,
    });
    const ids = candidates.map(c => c.zoneId);
    expect(ids).not.toContain('dungeonForge');
    expect(ids).toContain('townSquare');
    expect(ids).toContain('workshop');
  });

  it('excludes required-item zones', () => {
    const candidates = findZoneCandidatesForEntity({
      entityId: 'loom',
      zoneDefinitions: ZONE_DEFINITIONS,
      currentZoneId: null,
    });
    const ids = candidates.map(c => c.zoneId);
    expect(ids).not.toContain('secretLab');
    expect(ids).toContain('workshop');
  });

  it('orders nearest-first when currentZoneId is set', () => {
    // townSquare is at [5,5], northKitchen at [5,2]. From [5,5], north is closer.
    // Chebyshev(townSquare, townSquare)=0, Chebyshev(northKitchen, townSquare)=3
    const candidates = findZoneCandidatesForEntity({
      entityId: 'fire',
      zoneDefinitions: ZONE_DEFINITIONS,
      currentZoneId: 'townSquare',
    });
    expect(candidates[0].zoneId).toBe('townSquare');
    expect(candidates[1].zoneId).toBe('northKitchen');
  });

  it('returns empty array for an entity with zero accessible zones', () => {
    const candidates = findZoneCandidatesForEntity({
      entityId: 'nonexistentEntity',
      zoneDefinitions: ZONE_DEFINITIONS,
      currentZoneId: null,
    });
    expect(candidates).toEqual([]);
  });

  it('returns empty array when zoneDefinitions is falsy', () => {
    expect(findZoneCandidatesForEntity({ entityId: 'fire', zoneDefinitions: null, currentZoneId: null })).toEqual([]);
  });

  it('includes dungeon zones when includeDungeonZones is true', () => {
    const candidates = findZoneCandidatesForEntity({
      entityId: 'anvil',
      zoneDefinitions: ZONE_DEFINITIONS,
      currentZoneId: null,
      includeDungeonZones: true,
    });
    const ids = candidates.map(c => c.zoneId);
    expect(ids).toContain('dungeonForge');
    expect(ids).toContain('townSquare');
    expect(ids).toContain('workshop');
  });

  it('mob ids in entities object resolve zones', () => {
    const zoneWithMob = {
      ...ZONE_DEFINITIONS,
      mobZone: { name: 'Mob Zone', mapPos: [4, 4], entities: { 'giant-rat': {}, 'skeleton': {} }, isDungeon: false, requiredItem: null },
    };
    const candidates = findZoneCandidatesForEntity({
      entityId: 'giant-rat',
      zoneDefinitions: zoneWithMob,
      currentZoneId: null,
    });
    expect(candidates.map(c => c.zoneId)).toContain('mobZone');
  });
});

describe('resolveZoneForActivity — preference precedence', () => {
  const fireCandidates = [
    { zoneId: 'townSquare', zoneName: 'Town Square', distance: 0 },
    { zoneId: 'northKitchen', zoneName: 'North Kitchen', distance: 3 },
  ];

  it('prefers byActivityId over everything else', () => {
    const result = resolveZoneForActivity({
      entityId: 'fire',
      activityId: 'cook-shrimp',
      currentZoneId: 'townSquare',
      learnedZonePreferences: {
        byActivityId: { 'cook-shrimp': 'northKitchen' },
        byEntityId: { fire: 'townSquare' },
      },
      zoneCandidates: fireCandidates,
    });
    expect(result.zoneId).toBe('northKitchen');
    expect(result.resolutionSource).toBe('activity');
  });

  it('falls back to byEntityId when byActivityId has no match', () => {
    const result = resolveZoneForActivity({
      entityId: 'fire',
      activityId: 'cook-shark',
      currentZoneId: 'townSquare',
      learnedZonePreferences: {
        byActivityId: {},
        byEntityId: { fire: 'northKitchen' },
      },
      zoneCandidates: fireCandidates,
    });
    expect(result.zoneId).toBe('northKitchen');
    expect(result.resolutionSource).toBe('entity');
  });

  it('entity-level preference bridges two activities sharing the same entity', () => {
    // cook-shrimp was observed at northKitchen, so fire→northKitchen is learned.
    // cook-shark (never run) should resolve via the fire entity index.
    const prefs = {
      byActivityId: { 'cook-shrimp': 'northKitchen' },
      byEntityId: { fire: 'northKitchen' },
    };
    const result = resolveZoneForActivity({
      entityId: 'fire',
      activityId: 'cook-shark',
      currentZoneId: null,
      learnedZonePreferences: prefs,
      zoneCandidates: fireCandidates,
    });
    expect(result.zoneId).toBe('northKitchen');
    expect(result.resolutionSource).toBe('entity');
  });

  it('falls back to currentZoneId if it hosts the entity', () => {
    const result = resolveZoneForActivity({
      entityId: 'fire',
      activityId: 'cook-shark',
      currentZoneId: 'townSquare',
      learnedZonePreferences: { byActivityId: {}, byEntityId: {} },
      zoneCandidates: fireCandidates,
    });
    expect(result.zoneId).toBe('townSquare');
    expect(result.resolutionSource).toBe('currentZone');
  });

  it('returns the sole candidate when there is exactly one', () => {
    const result = resolveZoneForActivity({
      entityId: 'well',
      activityId: 'draw-water',
      currentZoneId: null,
      learnedZonePreferences: { byActivityId: {}, byEntityId: {} },
      zoneCandidates: [{ zoneId: 'soleWell', zoneName: 'Sole Well', distance: Infinity }],
    });
    expect(result.zoneId).toBe('soleWell');
    expect(result.resolutionSource).toBe('sole');
  });

  it('returns null with all candidates when multiple exist and no signal', () => {
    const result = resolveZoneForActivity({
      entityId: 'fire',
      activityId: 'cook-new',
      currentZoneId: null,
      learnedZonePreferences: { byActivityId: {}, byEntityId: {} },
      zoneCandidates: fireCandidates,
    });
    expect(result.zoneId).toBeNull();
    expect(result.resolutionSource).toBe('unresolved');
    expect(result.zoneCandidates).toEqual(fireCandidates);
  });

  it('ignores a learned preference that is not in the current candidate list', () => {
    // Preference points to a zone that no longer hosts the entity.
    const result = resolveZoneForActivity({
      entityId: 'fire',
      activityId: 'cook-shrimp',
      currentZoneId: null,
      learnedZonePreferences: {
        byActivityId: { 'cook-shrimp': 'removedZone' },
        byEntityId: {},
      },
      zoneCandidates: fireCandidates,
    });
    // Should fall through to unresolved (no current zone, multiple candidates)
    expect(result.zoneId).toBeNull();
    expect(result.resolutionSource).toBe('unresolved');
  });
});
