import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GoalSection from '../../src/popup/components/GoalSection';
import { setGoals } from '../../src/popup/utils/messages';

vi.mock('../../src/popup/utils/messages', () => ({
  setGoals: vi.fn().mockResolvedValue(null),
  getStatus: vi.fn().mockResolvedValue(null),
  setSkillNotify: vi.fn().mockResolvedValue(null),
  clearSkillNotify: vi.fn().mockResolvedValue(null),
}));

const items = [
  { id: 'woodLog', name: 'woodLog', count: 50, relatedToActivity: true },
  { id: 'stone', name: 'stone', count: 5, relatedToActivity: false },
  { id: 'ironOre', name: 'ironOre', count: 10, relatedToActivity: false },
  { id: 'ironBar', name: 'ironBar', count: 0, relatedToActivity: false, craftable: true },
  { id: 'coalOre', name: 'coalOre', count: 0, relatedToActivity: false },
  { id: 'goldOre', name: 'goldOre', count: 0, relatedToActivity: false },
  {
    id: 'arrows',
    name: 'arrows',
    count: 65,
    relatedToActivity: true,
    craftable: true,
    chanceDrop: true,
    acquisitionSources: ['craft', 'drops'],
  },
];

const woodStatus = {
  goal: { id: 'wood-goal', itemId: 'woodLog', itemName: 'Wood Log', targetCount: 100 },
  count: 50,
  eta: { totalMs: 120_000, bankTrips: 1 },
  relatedToActivity: true,
  warmupRemainingMs: 0,
};

const stoneStatus = {
  goal: { id: 'stone-goal', itemId: 'stone', itemName: 'Stone', targetCount: 20 },
  count: 5,
  eta: null,
  relatedToActivity: false,
  warmupRemainingMs: 0,
};

const impossibleBarStatus = {
  goal: {
    id: 'bar-goal',
    itemId: 'ironBar',
    itemName: 'Iron Bar',
    targetCount: 0,
    maxCraftable: true,
  },
  count: 0,
  eta: null,
  relatedToActivity: false,
  warmupRemainingMs: 0,
  planning: {
    goalId: 'bar-goal',
    craftable: true,
    maxCraftable: true,
    recipeId: 'smelt-iron',
    feasible: false,
    achievableTarget: 0,
    limitingItemIds: ['ironOre'],
    pending: false,
  },
};

const ambiguousArrowStatus = {
  goal: { id: 'arrow-goal', itemId: 'arrows', itemName: 'Arrows', targetCount: 70 },
  count: 65,
  eta: { totalMs: 60_000, bankTrips: 0 },
  relatedToActivity: true,
  warmupRemainingMs: 0,
  planning: {
    goalId: 'arrow-goal',
    craftable: true,
    feasible: true,
    achievableTarget: 70,
    sourceMode: 'any',
    sourceType: 'any',
    sourceOptions: ['any', 'craft', 'drops'],
    xpKnown: false,
  },
};

describe('GoalSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('waits for storage hydration before creating the initial rows', () => {
    const { rerender } = render(<GoalSection goalItems={items} goalStatuses={null} />);
    expect(screen.queryByPlaceholderText('Select item')).not.toBeInTheDocument();

    rerender(<GoalSection goalItems={items} goalStatuses={[woodStatus]} />);
    expect(screen.getByDisplayValue('Wood Log')).toBeInTheDocument();
  });

  it('starts with one draft row and adds another row with the plus button', async () => {
    const user = userEvent.setup();
    render(<GoalSection goalItems={items} goalStatuses={[]} />);

    expect(screen.getAllByPlaceholderText('Select item')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Add goal' }));
    expect(screen.getAllByPlaceholderText('Select item')).toHaveLength(2);
    expect(setGoals).not.toHaveBeenCalled();
  });

  it('persists a goal after an item and valid target are entered', async () => {
    const user = userEvent.setup();
    render(<GoalSection goalItems={items} goalStatuses={[]} />);

    await user.click(screen.getByPlaceholderText('Select item'));
    await user.click(screen.getByText('Wood Log'));
    await user.type(screen.getByRole('spinbutton', { name: 'Goal target' }), '100');
    await user.tab();

    expect(setGoals).toHaveBeenLastCalledWith([
      expect.objectContaining({
        itemName: 'Wood Log',
        itemId: 'woodLog',
        targetCount: 100,
      }),
    ]);
  });

  it('shows Max only for craftable items and makes its target read-only', async () => {
    const user = userEvent.setup();
    render(<GoalSection goalItems={items} goalStatuses={[]} />);

    await user.click(screen.getByPlaceholderText('Select item'));
    await user.click(screen.getByText('Iron Bar'));
    const max = screen.getByRole('button', { name: 'Use maximum craftable target' });
    expect(max).toHaveAttribute('aria-pressed', 'false');

    await user.click(max);
    expect(max).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('spinbutton', { name: 'Goal target' })).toHaveAttribute('readonly');
    expect(setGoals).toHaveBeenLastCalledWith([
      expect.objectContaining({ itemId: 'ironBar', targetCount: 0, maxCraftable: true }),
    ]);
  });

  it('syncs the target from the immediate background planning response', async () => {
    const user = userEvent.setup();
    const manualBarStatus = {
      ...impossibleBarStatus,
      goal: { ...impossibleBarStatus.goal, targetCount: 10, maxCraftable: undefined },
      planning: { ...impossibleBarStatus.planning, maxCraftable: false, feasible: true },
    };
    setGoals.mockResolvedValueOnce({
      goals: [{ ...impossibleBarStatus.goal, targetCount: 5 }],
      goalStatuses: [{
        ...impossibleBarStatus,
        goal: { ...impossibleBarStatus.goal, targetCount: 5 },
        planning: { ...impossibleBarStatus.planning, feasible: true, achievableTarget: 5 },
      }],
    });
    render(<GoalSection goalItems={items} goalStatuses={[manualBarStatus]} />);

    await user.click(screen.getByRole('button', { name: 'Use maximum craftable target' }));
    expect(screen.getByRole('spinbutton', { name: 'Goal target' })).toHaveValue(5);
    expect(screen.getByText('Limited by Iron Ore')).toBeInTheDocument();
  });

  it('shows an impossible Max goal at zero with a red limiting-item warning', () => {
    render(<GoalSection goalItems={items} goalStatuses={[impossibleBarStatus]} />);

    const row = document.querySelector('[data-goal-id="bar-goal"]');
    expect(row).toHaveClass('is-infeasible');
    expect(screen.getByText("Can't craft · limited by Iron Ore")).toBeInTheDocument();
    expect(screen.queryByText('0 / 0')).not.toBeInTheDocument();
    expect(screen.queryByText('Done!')).not.toBeInTheDocument();
  });

  it('shows chance-based drop context without Max or an XP projection', () => {
    const status = {
      goal: { id: 'fang-goal', itemId: 'wolfFang', itemName: 'Wolf Fang', targetCount: 10 },
      count: 0,
      eta: null,
      relatedToActivity: false,
      planning: {
        goalId: 'fang-goal',
        feasible: true,
        chanceBased: true,
        sourceType: 'chanceDrop',
        xpKnown: false,
        xpGained: 0,
        expectedLevel: null,
      },
    };
    render(
      <GoalSection
        goalItems={[...items, {
          id: 'wolfFang', name: 'wolfFang', count: 0, relatedToActivity: false, craftable: false,
        }]}
        goalStatuses={[status]}
      />
    );

    expect(screen.queryByRole('button', { name: 'Use maximum craftable target' }))
      .not.toBeInTheDocument();
    expect(screen.getByText('Chance-based drop · XP not projected')).toBeInTheDocument();
    expect(screen.queryByText(/Expected .* level:/)).not.toBeInTheDocument();
  });

  it('defaults ambiguous items to Any and enables Max only for Craft', async () => {
    const user = userEvent.setup();
    render(<GoalSection goalItems={items} goalStatuses={[ambiguousArrowStatus]} />);

    expect(screen.getByRole('button', { name: /^Any source\./ })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.queryByRole('button', { name: 'Use maximum craftable target' }))
      .not.toBeInTheDocument();
    expect(screen.getByText('Multiple sources · materials and XP not projected'))
      .toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Craft source\./ }));
    expect(screen.getByRole('button', { name: 'Use maximum craftable target' }))
      .toBeInTheDocument();
    expect(setGoals).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'arrow-goal', sourceMode: 'craft', targetCount: 70 }),
    ]);

    await user.click(screen.getByRole('button', { name: /^Drops source\./ }));
    expect(screen.queryByRole('button', { name: 'Use maximum craftable target' }))
      .not.toBeInTheDocument();
    expect(setGoals).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'arrow-goal', sourceMode: 'drops', targetCount: 70 }),
    ]);
  });

  it('turns an impossible Max goal back into an empty manual draft', async () => {
    const user = userEvent.setup();
    render(<GoalSection goalItems={items} goalStatuses={[impossibleBarStatus]} />);

    await user.click(screen.getByRole('button', { name: 'Use maximum craftable target' }));

    expect(screen.getByRole('spinbutton', { name: 'Goal target' })).not.toHaveAttribute('readonly');
    expect(screen.getByRole('spinbutton', { name: 'Goal target' })).toHaveValue(null);
    expect(setGoals).toHaveBeenLastCalledWith([]);
  });

  it('keeps a manual target while warning how much is achievable', () => {
    const status = {
      ...impossibleBarStatus,
      goal: { ...impossibleBarStatus.goal, targetCount: 8, maxCraftable: undefined },
      planning: {
        ...impossibleBarStatus.planning,
        maxCraftable: false,
        achievableTarget: 5,
      },
    };
    render(<GoalSection goalItems={items} goalStatuses={[status]} />);

    expect(screen.getByRole('spinbutton', { name: 'Goal target' })).toHaveValue(8);
    expect(screen.getByText('Only 5 achievable · limited by Iron Ore')).toBeInTheDocument();
  });

  it('shows projected XP and expected skill level after an achievable goal', () => {
    const status = {
      goal: { id: 'coal-goal', itemId: 'coalOre', itemName: 'Coal Ore', targetCount: 9999 },
      count: 0,
      eta: null,
      relatedToActivity: false,
      planning: {
        goalId: 'coal-goal',
        feasible: true,
        materialFeasible: true,
        levelFeasible: true,
        skill: 'mining',
        requiredLevel: 30,
        projectedLevelBefore: 30,
        expectedLevel: 40,
        xpGained: 559944,
        xpKnown: true,
        limitingItemIds: [],
        pending: false,
      },
    };
    render(<GoalSection goalItems={items} goalStatuses={[status]} />);

    expect(screen.getByText('Expected Mining level: 40 · +559,944 XP')).toBeInTheDocument();
  });

  it('marks a level-locked goal red and explains the projected shortfall', () => {
    const status = {
      goal: { id: 'gold-goal', itemId: 'goldOre', itemName: 'Gold Ore', targetCount: 1 },
      count: 0,
      eta: null,
      relatedToActivity: false,
      planning: {
        goalId: 'gold-goal',
        feasible: false,
        materialFeasible: true,
        levelFeasible: false,
        skill: 'mining',
        requiredLevel: 40,
        projectedLevelBefore: 30,
        expectedLevel: 30,
        xpGained: 0,
        xpKnown: true,
        limitingItemIds: [],
        pending: false,
      },
    };
    render(<GoalSection goalItems={items} goalStatuses={[status]} />);

    expect(document.querySelector('[data-goal-id="gold-goal"]')).toHaveClass('is-infeasible');
    expect(screen.getByText('Requires Mining Lv 40 · projected Lv 30')).toBeInTheDocument();
    expect(screen.queryByText(/Expected Mining level/)).not.toBeInTheDocument();
  });

  it('prioritizes a level lock over a simultaneous material shortage', () => {
    const status = {
      goal: { id: 'vial-goal', itemId: 'vial', itemName: 'Vial', targetCount: 1 },
      count: 0,
      eta: null,
      relatedToActivity: false,
      planning: {
        goalId: 'vial-goal',
        feasible: false,
        materialFeasible: false,
        levelFeasible: false,
        skill: 'crafting',
        requiredLevel: 33,
        projectedLevelBefore: 8,
        achievableTarget: 0,
        limitingItemIds: ['moltenGlass'],
        pending: false,
      },
    };
    render(
      <GoalSection
        goalItems={[
          ...items,
          { id: 'vial', name: 'vial', count: 0, craftable: true },
          { id: 'moltenGlass', name: 'moltenGlass', count: 0 },
        ]}
        goalStatuses={[status]}
      />
    );

    expect(screen.getByText('Requires Crafting Lv 33 · projected Lv 8')).toBeInTheDocument();
    expect(screen.queryByText(/Only 0 achievable/)).not.toBeInTheDocument();
    expect(screen.queryByText(/limited by Molten Glass/)).not.toBeInTheDocument();
  });

  it('renders progress for every saved goal but ETA only for a related item', () => {
    render(<GoalSection goalItems={items} goalStatuses={[woodStatus, stoneStatus]} />);

    expect(screen.getByText('50 / 100')).toBeInTheDocument();
    expect(screen.getByText('5 / 20')).toBeInTheDocument();
    expect(screen.getByText(/ETA 2m 0s/)).toBeInTheDocument();
    expect(screen.getAllByLabelText('ETA estimate details')).toHaveLength(1);
    expect(document.querySelectorAll('.progress-bar')).toHaveLength(2);
  });

  it('highlights only goals related to the current activity', () => {
    render(<GoalSection goalItems={items} goalStatuses={[woodStatus, stoneStatus]} />);

    expect(document.querySelector('[data-goal-id="wood-goal"]'))
      .toHaveClass('is-current-activity');
    expect(document.querySelector('[data-goal-id="stone-goal"]'))
      .not.toHaveClass('is-current-activity');
  });

  it('does not show done until the actual count reaches the target', () => {
    const { rerender } = render(
      <GoalSection
        goalItems={items}
        goalStatuses={[{ ...woodStatus, count: 99, eta: 0 }]}
      />
    );

    expect(screen.getByText('ETA <1s')).toBeInTheDocument();
    expect(screen.queryByText('Done!')).not.toBeInTheDocument();

    rerender(
      <GoalSection
        goalItems={items}
        goalStatuses={[{ ...woodStatus, count: 100, eta: 0 }]}
      />
    );
    expect(screen.getByText('Done!')).toBeInTheDocument();
  });

  it('removes only the selected goal', async () => {
    const user = userEvent.setup();
    render(<GoalSection goalItems={items} goalStatuses={[woodStatus, stoneStatus]} />);

    await user.click(screen.getAllByRole('button', { name: 'Remove goal' })[0]);
    expect(setGoals).toHaveBeenLastCalledWith([stoneStatus.goal]);
    expect(screen.queryByDisplayValue('Wood Log')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Stone')).toBeInTheDocument();
  });

  it('preserves a saved goal while its target is temporarily invalid', async () => {
    const user = userEvent.setup();
    render(<GoalSection goalItems={items} goalStatuses={[woodStatus]} />);

    const target = screen.getByRole('spinbutton', { name: 'Goal target' });
    await user.clear(target);
    await user.tab();
    expect(setGoals).toHaveBeenLastCalledWith([woodStatus.goal]);
  });

  it('persists drag-and-drop row order', () => {
    render(<GoalSection goalItems={items} goalStatuses={[woodStatus, stoneStatus]} />);
    const handles = screen.getAllByRole('button', { name: 'Drag to reorder goal' });
    const dataTransfer = { effectAllowed: '', setData: vi.fn() };

    fireEvent.dragStart(handles[1], { dataTransfer });
    fireEvent.drop(document.querySelector('[data-goal-id="wood-goal"]'), { dataTransfer });

    expect(setGoals).toHaveBeenLastCalledWith([stoneStatus.goal, woodStatus.goal]);
  });

  it('shows the insertion edge that matches the existing reorder behavior', () => {
    render(<GoalSection goalItems={items} goalStatuses={[woodStatus, stoneStatus]} />);
    const handles = screen.getAllByRole('button', { name: 'Drag to reorder goal' });
    const woodRow = document.querySelector('[data-goal-id="wood-goal"]');
    const stoneRow = document.querySelector('[data-goal-id="stone-goal"]');
    const dataTransfer = { effectAllowed: '', setData: vi.fn() };

    fireEvent.dragStart(handles[0], { dataTransfer });
    fireEvent.dragOver(stoneRow, { dataTransfer });
    expect(stoneRow).toHaveClass('drop-after');

    fireEvent.dragEnd(handles[0], { dataTransfer });
    fireEvent.dragStart(handles[1], { dataTransfer });
    fireEvent.dragOver(woodRow, { dataTransfer });
    expect(woodRow).toHaveClass('drop-before');
  });

  it('clears a pending insertion marker when dragged back over its original row', () => {
    render(<GoalSection goalItems={items} goalStatuses={[woodStatus, stoneStatus]} />);
    const handles = screen.getAllByRole('button', { name: 'Drag to reorder goal' });
    const woodRow = document.querySelector('[data-goal-id="wood-goal"]');
    const stoneRow = document.querySelector('[data-goal-id="stone-goal"]');
    const dataTransfer = { effectAllowed: '', setData: vi.fn() };

    fireEvent.dragStart(handles[1], { dataTransfer });
    fireEvent.dragOver(woodRow, { dataTransfer });
    expect(woodRow).toHaveClass('drop-before');

    fireEvent.dragOver(stoneRow, { dataTransfer });
    expect(woodRow).not.toHaveClass('drop-before');
    expect(document.querySelector('.drop-before, .drop-after')).not.toBeInTheDocument();
  });

  it('shows the calibration countdown for a warming related ETA', () => {
    render(
      <GoalSection
        goalItems={items}
        goalStatuses={[{ ...woodStatus, warmupRemainingMs: 300_000 }]}
      />
    );
    expect(screen.getByText('Calibrating... 5m 0s')).toBeInTheDocument();
  });
});
