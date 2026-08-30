import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DebugSection from '../../src/popup/components/debugSection';

describe('DebugSection', () => {
  it('shows goal reminder state and lifecycle events', () => {
    render(
      <DebugSection
        tickLog={[]}
        etaDebugLog={[]}
        etaDebugLogVersion={1}
        goalNagDebug={{
          intervalMs: 300_000,
          scheduledFor: { ore: 601_000 },
          completedGoals: [{ id: 'ore', related: true }],
          events: [{ type: 'alarm-scheduled', goalId: 'ore' }],
        }}
      />
    );

    expect(screen.getByText('Debug — goal reminders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeInTheDocument();
    expect(document.querySelector('#goal-nag-debug-pre')).toHaveTextContent('alarm-scheduled');
    expect(document.querySelector('#goal-nag-debug-pre')).toHaveTextContent('300000');
  });
});
