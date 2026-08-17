import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SkillSection from '../../src/popup/components/SkillSection';
import { setSkillNotify, clearSkillNotify } from '../../src/popup/utils/messages';

vi.mock('../../src/popup/utils/messages', () => ({
  setGoal:          vi.fn().mockResolvedValue(null),
  clearGoal:        vi.fn().mockResolvedValue(null),
  getStatus:        vi.fn().mockResolvedValue(null),
  setSkillNotify:   vi.fn().mockResolvedValue(null),
  clearSkillNotify: vi.fn().mockResolvedValue(null),
}));

const skillStatus = {
  skill: 'defense',
  currentLevel: 12,
  etas: [
    { targetLevel: 13, xpNeeded: 1882, etaMs: 1860000 },
    { targetLevel: 14, xpNeeded: 5000, etaMs: 4200000 },
  ],
};

describe('SkillSection', () => {
  it('renders null when skillLevelStatus is absent', () => {
    const { container } = render(<SkillSection skillLevelStatus={null} skillNotifyTarget={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders null when etas array is empty', () => {
    const { container } = render(
      <SkillSection skillLevelStatus={{ skill: 'defense', currentLevel: 12, etas: [] }} skillNotifyTarget={null} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders skill name, level, and first ETA target', () => {
    render(<SkillSection skillLevelStatus={skillStatus} skillNotifyTarget={null} />);
    expect(screen.getByText(/Defense Lv 12/)).toBeInTheDocument();
    expect(screen.getByText(/→ Lv 13/)).toBeInTheDocument();
  });

  it('toggle is unchecked when no notify target is set', () => {
    render(<SkillSection skillLevelStatus={skillStatus} skillNotifyTarget={null} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('toggle is checked when notify target matches current selection', () => {
    render(
      <SkillSection
        skillLevelStatus={skillStatus}
        skillNotifyTarget={{ skill: 'defense', level: 13 }}
      />
    );
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('calls setSkillNotify when toggle is turned on', async () => {
    const user = userEvent.setup();
    render(<SkillSection skillLevelStatus={skillStatus} skillNotifyTarget={null} />);
    await user.click(screen.getByRole('checkbox'));
    expect(setSkillNotify).toHaveBeenCalledWith('defense', 13);
  });

  it('calls clearSkillNotify when toggle is turned off', async () => {
    const user = userEvent.setup();
    render(
      <SkillSection
        skillLevelStatus={skillStatus}
        skillNotifyTarget={{ skill: 'defense', level: 13 }}
      />
    );
    await user.click(screen.getByRole('checkbox'));
    expect(clearSkillNotify).toHaveBeenCalled();
  });

  it('shows calibration countdown for warming skill ETA', () => {
    render(
      <SkillSection
        skillLevelStatus={{
          ...skillStatus,
          etas: [{ ...skillStatus.etas[0], warmupRemainingMs: 300000 }],
        }}
        skillNotifyTarget={null}
      />
    );
    expect(screen.getByText('Calibrating... 5m 0s')).toBeInTheDocument();
  });
});
