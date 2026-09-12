import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from 'styled-components';
import { theme } from '../../src/popup/theme.js';
import QueueStepDropSourceRow from '../../src/popup/components/setQueue/QueueStepDropSourceRow';

const COMBAT_SKILLS = [
  { id: 'attack', name: 'Attack' },
  { id: 'strength', name: 'Strength' },
  { id: 'defense', name: 'Defense' },
  { id: 'ranged', name: 'Ranged' },
];

const baseStep = {
  isChanceBased: true,
  selectedActivityId: 'fight-giant-rat',
  combatSkillId: 'attack',
  combatSkillOptions: COMBAT_SKILLS,
  dropSourceCandidates: [
    {
      activityId: 'fight-giant-rat',
      activityName: 'giant rat',
      mobId: 'giant-rat',
      entityId: 'giant-rat',
      isCombat: true,
      rarity: 1,
      dropChanceLabel: '1 in 2',
      mobCombatLevel: 3,
      mobMinimumCombatLevel: 0,
      mobRequiredItem: null,
      mobSafeSpot: false,
      blockedReason: null,
      zoneCandidates: [],
    },
    {
      activityId: 'fight-demon',
      activityName: 'demon',
      mobId: 'demon',
      entityId: 'demon',
      isCombat: true,
      rarity: 3,
      dropChanceLabel: '1 in 8',
      mobCombatLevel: 50,
      mobMinimumCombatLevel: 40,
      mobRequiredItem: null,
      mobSafeSpot: false,
      blockedReason: null,
      zoneCandidates: [],
    },
    {
      activityId: 'fight-chest',
      activityName: 'chest',
      mobId: 'chest',
      entityId: 'chest',
      isCombat: true,
      rarity: 2,
      dropChanceLabel: '1 in 4',
      mobCombatLevel: 10,
      mobMinimumCombatLevel: 0,
      mobRequiredItem: 'dungeonKey',
      mobSafeSpot: false,
      blockedReason: 'requires-item',
      zoneCandidates: [],
    },
  ],
};

const skillStep = {
  isChanceBased: true,
  selectedActivityId: 'fish-trout',
  combatSkillId: null,
  combatSkillOptions: [],
  dropSourceCandidates: [
    {
      activityId: 'fish-trout',
      activityName: 'fish trout',
      mobId: null,
      entityId: 'trout',
      isCombat: false,
      rarity: 7,
      dropChanceLabel: '1 in 128',
      mobCombatLevel: null,
      mobMinimumCombatLevel: 0,
      mobRequiredItem: null,
      mobSafeSpot: false,
      blockedReason: null,
      zoneCandidates: [],
    },
    {
      activityId: 'fish-salmon',
      activityName: 'fish salmon',
      mobId: null,
      entityId: 'salmon',
      isCombat: false,
      rarity: 7,
      dropChanceLabel: '1 in 128',
      mobCombatLevel: null,
      mobMinimumCombatLevel: 0,
      mobRequiredItem: null,
      mobSafeSpot: false,
      blockedReason: null,
      zoneCandidates: [],
    },
  ],
};

function renderRow(props = {}) {
  const step = { ...baseStep, ...props.step };
  return render(
    <ThemeProvider theme={theme}>
      <QueueStepDropSourceRow
        step={step}
        stepIndex={0}
        onSelectDropSource={props.onSelectDropSource ?? vi.fn()}
        onSelectCombatSkill={props.onSelectCombatSkill ?? vi.fn()}
        playerCombatLevel={props.playerCombatLevel ?? 10}
      />
    </ThemeProvider>
  );
}

describe('QueueStepDropSourceRow', () => {
  it('renders the selected monster name without drop chance in the trigger', () => {
    renderRow();
    expect(screen.getByText('giant rat')).toBeInTheDocument();
    expect(screen.queryByText(/1 in 2/)).not.toBeInTheDocument();
  });

  it('renders the selected combat skill name', () => {
    renderRow();
    expect(screen.getByText(/Attack/)).toBeInTheDocument();
  });

  it('shows "needs lv N" hint for above-minimumCombatLevel candidates in monster picker', async () => {
    const user = userEvent.setup();
    renderRow({ playerCombatLevel: 10 });
    // Open monster picker (second trigger — focus is first)
    const triggers = screen.getAllByRole('button');
    await user.click(triggers[1]);
    expect(screen.getByText('needs lv 40')).toBeInTheDocument();
  });

  it('shows "needs <item>" hint for requires-item candidates', async () => {
    const user = userEvent.setup();
    renderRow({ playerCombatLevel: 50 });
    const triggers = screen.getAllByRole('button');
    await user.click(triggers[1]); // monster picker is second trigger
    expect(screen.getByText('needs dungeonKey')).toBeInTheDocument();
  });

  it('calls onSelectDropSource when a monster is clicked', async () => {
    const user = userEvent.setup();
    const onSelectDropSource = vi.fn();
    renderRow({ onSelectDropSource, playerCombatLevel: 100 });
    const triggers = screen.getAllByRole('button');
    await user.click(triggers[1]); // monster picker is second trigger
    // Click the demon option (not disabled at level 100)
    const demonOption = screen.getByText('demon');
    await user.click(demonOption);
    expect(onSelectDropSource).toHaveBeenCalledWith(0, 'fight-demon');
  });

  it('calls onSelectCombatSkill when a skill is clicked', async () => {
    const user = userEvent.setup();
    const onSelectCombatSkill = vi.fn();
    renderRow({ onSelectCombatSkill });
    const triggers = screen.getAllByRole('button');
    await user.click(triggers[0]); // skill picker is first trigger
    const strengthOption = screen.getByText('Strength');
    await user.click(strengthOption);
    expect(onSelectCombatSkill).toHaveBeenCalledWith(0, 'strength');
  });

  describe('skill drop source (fishing)', () => {
    it('renders the selected skill activity name and shows "source" label, no focus picker', () => {
      renderRow({ step: skillStep });
      expect(screen.getByText('fish trout')).toBeInTheDocument();
      expect(screen.getByText('source')).toBeInTheDocument();
      expect(screen.queryByText('focus')).not.toBeInTheDocument();
      expect(screen.queryByText('fight')).not.toBeInTheDocument();
    });

    it('shows only one trigger button for a skill source', () => {
      renderRow({ step: skillStep });
      const triggers = screen.getAllByRole('button');
      expect(triggers).toHaveLength(1);
    });

    it('shows drop chance hint for skill candidates', async () => {
      const user = userEvent.setup();
      renderRow({ step: skillStep });
      const [trigger] = screen.getAllByRole('button');
      await user.click(trigger);
      // Both candidates share the same rarity so multiple hints appear
      const hints = screen.getAllByText('1 in 128');
      expect(hints.length).toBeGreaterThan(0);
    });

    it('calls onSelectDropSource when a skill activity is clicked', async () => {
      const user = userEvent.setup();
      const onSelectDropSource = vi.fn();
      renderRow({ step: skillStep, onSelectDropSource });
      const [trigger] = screen.getAllByRole('button');
      await user.click(trigger);
      await user.click(screen.getByText('fish salmon'));
      expect(onSelectDropSource).toHaveBeenCalledWith(0, 'fish-salmon');
    });
  });
});
