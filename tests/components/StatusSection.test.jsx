import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusSection from '../../src/popup/components/StatusSection';

describe('StatusSection', () => {
  it('shows Not connected when disconnected', () => {
    render(<StatusSection connected={false} />);
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });

  it('shows IDLE when connected and idle', () => {
    render(<StatusSection connected={true} idle={true} />);
    expect(screen.getByText('IDLE')).toBeInTheDocument();
  });

  it('shows Observing when connected but no activity', () => {
    render(<StatusSection connected={true} idle={false} activity={null} />);
    expect(screen.getByText('Observing…')).toBeInTheDocument();
  });

  it('shows activity name and tick rate when active', () => {
    render(<StatusSection connected={true} idle={false} activity="fight-goblin" tickMs={1994} />);
    expect(screen.getByText('fight-goblin')).toBeInTheDocument();
    expect(screen.getByText('1994ms tick')).toBeInTheDocument();
  });

  it('applies the active class when active', () => {
    render(<StatusSection connected={true} idle={false} activity="fight-goblin" tickMs={500} />);
    expect(screen.getByText('fight-goblin').className).toContain('active');
  });

  it('applies the idle class when idle', () => {
    render(<StatusSection connected={true} idle={true} />);
    expect(screen.getByText('IDLE').className).toContain('idle');
  });
});
