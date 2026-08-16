import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, act } from '@testing-library/react';
import EtaTooltip from '../../src/popup/components/EtaTooltip';
import { ETA_INFO_TITLE } from '../../src/popup/utils/format';

describe('EtaTooltip', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows the tooltip after the configured hover delay', () => {
    render(<EtaTooltip delayMs={25} />);

    const trigger = screen.getByLabelText('ETA estimate details');
    expect(trigger).not.toHaveAttribute('title');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.mouseEnter(trigger);
    act(() => { vi.advanceTimersByTime(24); });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('tooltip')).toHaveTextContent(ETA_INFO_TITLE);
  });

  it('hides the tooltip on mouse leave', () => {
    render(<EtaTooltip delayMs={25} />);

    const trigger = screen.getByLabelText('ETA estimate details');
    fireEvent.mouseEnter(trigger);
    act(() => { vi.advanceTimersByTime(25); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('supports keyboard focus', () => {
    render(<EtaTooltip delayMs={25} />);

    const trigger = screen.getByLabelText('ETA estimate details');
    fireEvent.focus(trigger);
    act(() => { vi.advanceTimersByTime(25); });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent(ETA_INFO_TITLE);
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
  });
});
