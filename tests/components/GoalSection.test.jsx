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
