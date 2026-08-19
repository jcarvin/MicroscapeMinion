import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GoalSourceSelector, {
  GOAL_SOURCE_OPTIONS,
} from '../../src/popup/components/GoalSourceSelector';

describe('GoalSourceSelector', () => {
  afterEach(() => vi.useRealTimers());

  it('explains every source option with an accessible tooltip', () => {
    vi.useFakeTimers();
    render(<GoalSourceSelector value="any" onChange={() => {}} delayMs={10} />);

    for (const option of GOAL_SOURCE_OPTIONS) {
      const button = screen.getByRole('button', { name: new RegExp(`^${option.label} source\\.`) });
      fireEvent.focus(button);
      act(() => vi.advanceTimersByTime(10));

      const tooltip = screen.getByRole('tooltip');
      expect(tooltip).toHaveTextContent(option.description);
      expect(button).toHaveAttribute('aria-describedby', tooltip.id);

      fireEvent.blur(button);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    }
  });

  it('reports the selected source', () => {
    const onChange = vi.fn();
    render(<GoalSourceSelector value="any" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /^Drops source\./ }));

    expect(onChange).toHaveBeenCalledWith('drops');
  });
});
