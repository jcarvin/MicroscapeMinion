import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GoalSection from '../../src/popup/components/GoalSection';
import { setGoal, clearGoal } from '../../src/popup/utils/messages';

vi.mock('../../src/popup/utils/messages', () => ({
  setGoal:        vi.fn().mockResolvedValue(null),
  clearGoal:      vi.fn().mockResolvedValue(null),
  getStatus:      vi.fn().mockResolvedValue(null),
  setSkillNotify: vi.fn().mockResolvedValue(null),
  clearSkillNotify: vi.fn().mockResolvedValue(null),
}));

const singleItem = [{ id: 'woodLog', count: 50 }];

describe('GoalSection', () => {
  it('does not call setGoal when nothing is selected or entered', async () => {
    const user = userEvent.setup();
    render(<GoalSection producibleItems={[]} goalStatus={null} />);
    await user.click(screen.getByText('Set'));
    expect(setGoal).not.toHaveBeenCalled();
  });

  it('calls setGoal with correct payload for a single auto-selected item', async () => {
    const user = userEvent.setup();
    render(<GoalSection producibleItems={singleItem} goalStatus={null} />);
    await user.type(screen.getByPlaceholderText('Target'), '100');
    await user.click(screen.getByText('Set'));
    expect(setGoal).toHaveBeenCalledWith({
      itemName: 'Wood Log',
      itemId: 'woodLog',
      targetCount: 100,
    });
  });

  it('hides goal status and clear button when goalStatus is null', () => {
    render(<GoalSection producibleItems={[]} goalStatus={null} />);
    expect(screen.queryByText('Clear goal')).not.toBeInTheDocument();
    expect(document.querySelector('.goal-status')).not.toBeInTheDocument();
  });

  it('shows progress bar and clear button when goalStatus is present', () => {
    const goalStatus = {
      count: 50,
      goal: { itemId: 'woodLog', itemName: 'Wood Log', targetCount: 100 },
      eta: null,
    };
    render(<GoalSection producibleItems={singleItem} goalStatus={goalStatus} />);
    expect(screen.getByText('Clear goal')).toBeInTheDocument();
    expect(document.querySelector('.goal-status')).toBeInTheDocument();
  });

  it('sets progress bar width proportionally', () => {
    const goalStatus = {
      count: 25,
      goal: { itemId: 'woodLog', itemName: 'Wood Log', targetCount: 100 },
      eta: null,
    };
    render(<GoalSection producibleItems={singleItem} goalStatus={goalStatus} />);
    const bar = document.querySelector('.progress-bar');
    expect(bar.style.width).toBe('25%');
  });

  it('does not show done until the actual goal count reaches the target', () => {
    const { rerender } = render(
      <GoalSection
        producibleItems={singleItem}
        goalStatus={{
          count: 99,
          goal: { itemId: 'woodLog', itemName: 'Wood Log', targetCount: 100 },
          eta: 0,
        }}
      />
    );

    expect(screen.getByText('ETA <1s')).toBeInTheDocument();
    expect(screen.queryByText('Done!')).not.toBeInTheDocument();

    rerender(
      <GoalSection
        producibleItems={singleItem}
        goalStatus={{
          count: 100,
          goal: { itemId: 'woodLog', itemName: 'Wood Log', targetCount: 100 },
          eta: 0,
        }}
      />
    );

    expect(screen.getByText('Done!')).toBeInTheDocument();
  });

  it('calls clearGoal and resets inputs on clear', async () => {
    const user = userEvent.setup();
    const goalStatus = {
      count: 10,
      goal: { itemId: 'woodLog', itemName: 'Wood Log', targetCount: 50 },
      eta: null,
    };
    render(<GoalSection producibleItems={singleItem} goalStatus={goalStatus} />);
    await user.click(screen.getByText('Clear goal'));
    expect(clearGoal).toHaveBeenCalled();
  });
});
