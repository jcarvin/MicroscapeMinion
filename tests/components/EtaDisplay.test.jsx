import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import EtaDisplay from '../../src/popup/components/EtaDisplay';

describe('EtaDisplay', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows calibrating when etaMs is null', () => {
    render(<EtaDisplay etaMs={null} />);
    expect(screen.getByText('ETA calibrating…')).toBeInTheDocument();
  });

  it('shows default doneLabel when etaMs is 0', () => {
    render(<EtaDisplay etaMs={0} />);
    expect(screen.getByText('Done!')).toBeInTheDocument();
  });

  it('shows custom doneLabel', () => {
    render(<EtaDisplay etaMs={0} doneLabel="Out now" />);
    expect(screen.getByText('Out now')).toBeInTheDocument();
  });

  it('shows formatted ETA for positive etaMs', () => {
    render(<EtaDisplay etaMs={90000} />);
    expect(screen.getByText('ETA 1m 30s')).toBeInTheDocument();
  });

  it('counts down each second', () => {
    render(<EtaDisplay etaMs={5000} />);
    expect(screen.getByText('ETA 5s')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('ETA 4s')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('ETA 3s')).toBeInTheDocument();
  });

  it('shows doneLabel when countdown reaches zero', () => {
    render(<EtaDisplay etaMs={2000} doneLabel="Done!" />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText('Done!')).toBeInTheDocument();
  });

  it('does not show doneLabel at zero when completion is explicitly false', () => {
    render(<EtaDisplay etaMs={0} complete={false} />);
    expect(screen.getByText('ETA <1s')).toBeInTheDocument();
    expect(screen.queryByText('Done!')).not.toBeInTheDocument();
  });

  it('appends singular bank trip note', () => {
    render(<EtaDisplay etaMs={60000} bankTrips={1} />);
    expect(screen.getByText('ETA 1m 0s (+1 bank trip)')).toBeInTheDocument();
  });

  it('appends plural bank trips note', () => {
    render(<EtaDisplay etaMs={60000} bankTrips={2} />);
    expect(screen.getByText('ETA 1m 0s (+2 bank trips)')).toBeInTheDocument();
  });

  it('shows a live calibration countdown under a positive ETA', () => {
    render(<EtaDisplay etaMs={60000} warmupRemainingMs={300000} />);
    expect(screen.getByText('Calibrating... 5m 0s')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('Calibrating... 4m 59s')).toBeInTheDocument();
  });
});
