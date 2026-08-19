import { describe, expect, it } from 'vitest';
import activityDefs from '../src/activity-defs.json';
import { getCraftableItemIds } from '../src/goal-planner.js';

describe('activity definition seed data', () => {
  it('includes piety bone-burying activities with consumed bones and XP', () => {
    expect(activityDefs['bury-bones']).toEqual({
      durationMs: 16000,
      level: 1,
      xpPerCycle: 4,
      inventoryChanges: {
        bones: -1,
        spiritRune: 1,
      },
    });
    expect(activityDefs['bury-big-bones']).toMatchObject({
      durationMs: 16000,
      level: 1,
      xpPerCycle: 12,
      inventoryChanges: { bigBones: -1 },
    });
    expect(activityDefs['bury-dragon-bones']).toMatchObject({
      durationMs: 16000,
      level: 1,
      xpPerCycle: 60,
      inventoryChanges: { dragonBones: -1 },
    });
  });

  it('includes mining requirements and XP for ordered goal projections', () => {
    expect(activityDefs['mine-coal']).toMatchObject({ level: 30, xpPerCycle: 56 });
    expect(activityDefs['mine-gold']).toMatchObject({ level: 40, xpPerCycle: 66 });
    expect(activityDefs['mine-prog']).toMatchObject({ level: 85, xpPerCycle: 125 });
  });

  it('includes required levels and XP for every bundled activity', () => {
    for (const [activityId, def] of Object.entries(activityDefs)) {
      expect(def.level, `${activityId} level`).toBeTypeOf('number');
      expect(Number.isSafeInteger(def.level), `${activityId} level`).toBe(true);
      expect(def.level, `${activityId} level`).toBeGreaterThanOrEqual(1);
      expect(def.xpPerCycle, `${activityId} XP`).toBeTypeOf('number');
      expect(Number.isSafeInteger(def.xpPerCycle), `${activityId} XP`).toBe(true);
      expect(def.xpPerCycle, `${activityId} XP`).toBeGreaterThanOrEqual(0);
    }

    expect(activityDefs['smelt-steel']).toMatchObject({ level: 30, xpPerCycle: 17 });
    expect(activityDefs['craft-vial']).toMatchObject({ level: 33, xpPerCycle: 35 });
  });

  it('does not treat bait-consuming fishing activities as Max recipes', () => {
    const craftableItems = getCraftableItemIds(activityDefs);

    expect(craftableItems).not.toContain('rawSardine');
    expect(craftableItems).not.toContain('rawTrout');
    expect(craftableItems).not.toContain('rawSalmon');
    expect(craftableItems).toContain('cookedSalmon');
  });
});
