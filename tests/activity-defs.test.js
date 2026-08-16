import { describe, expect, it } from 'vitest';
import activityDefs from '../src/activity-defs.json';

describe('activity definition seed data', () => {
  it('includes piety bone-burying activities with consumed bones and XP', () => {
    expect(activityDefs['bury-bones']).toEqual({
      durationMs: 16000,
      xpPerCycle: 4,
      inventoryChanges: {
        bones: -1,
        spiritRune: 1,
      },
    });
    expect(activityDefs['bury-big-bones']).toMatchObject({
      durationMs: 16000,
      xpPerCycle: 12,
      inventoryChanges: { bigBones: -1 },
    });
    expect(activityDefs['bury-dragon-bones']).toMatchObject({
      durationMs: 16000,
      xpPerCycle: 60,
      inventoryChanges: { dragonBones: -1 },
    });
  });
});
