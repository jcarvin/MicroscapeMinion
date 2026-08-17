import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MaterialSection from '../../src/popup/components/MaterialSection';

const baseRunout = {
  itemId: 'bones',
  costPerCycle: 1,
  totalMaterial: 100,
  cyclesLeft: 100,
  etaMs: 160000,
};

describe('MaterialSection', () => {
  it('renders nothing when runoutStatus is null', () => {
    const { container } = render(
      <MaterialSection runoutStatus={null} selectedSkillEta={null} xpPerCycle={0} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the Material Runout card label', () => {
    render(<MaterialSection runoutStatus={baseRunout} selectedSkillEta={null} xpPerCycle={0} />);
    expect(screen.getByText('Material Runout')).toBeInTheDocument();
  });

  it('shows formatted item name and cycle count', () => {
    render(<MaterialSection runoutStatus={baseRunout} selectedSkillEta={null} xpPerCycle={0} />);
    expect(screen.getByText(/Bones: 100/)).toBeInTheDocument();
  });

  it('shows totalMaterial when cyclesLeft is null', () => {
    const rs = { ...baseRunout, cyclesLeft: null };
    render(<MaterialSection runoutStatus={rs} selectedSkillEta={null} xpPerCycle={0} />);
    expect(screen.getByText(/100 remaining/)).toBeInTheDocument();
  });

  it('shows "Out now" ETA label when etaMs is 0', () => {
    const rs = { ...baseRunout, cyclesLeft: 0, etaMs: 0 };
    render(<MaterialSection runoutStatus={rs} selectedSkillEta={null} xpPerCycle={0} />);
    expect(screen.getByText('Out now')).toBeInTheDocument();
  });

  it('shows shortage message when bones are insufficient for level goal', () => {
    // Need 500 bones (125 cycles * 4 xp/cycle → 125 cycles), have 100
    render(
      <MaterialSection
        runoutStatus={{ ...baseRunout, totalMaterial: 100 }}
        selectedSkillEta={{ targetLevel: 10, xpNeeded: 500 }}
        xpPerCycle={4}
      />
    );
    expect(screen.getByText(/Need 25 more Bones for Lv 10/)).toBeInTheDocument();
  });

  it('shows sufficient message when bones are enough for level goal', () => {
    render(
      <MaterialSection
        runoutStatus={{ ...baseRunout, totalMaterial: 500 }}
        selectedSkillEta={{ targetLevel: 10, xpNeeded: 500 }}
        xpPerCycle={4}
      />
    );
    expect(screen.getByText(/Enough Bones for Lv 10/)).toBeInTheDocument();
  });

  it('shows no level goal line when xpPerCycle is 0', () => {
    render(
      <MaterialSection
        runoutStatus={baseRunout}
        selectedSkillEta={{ targetLevel: 10, xpNeeded: 500 }}
        xpPerCycle={0}
      />
    );
    expect(screen.queryByText(/for Lv/)).not.toBeInTheDocument();
  });

  it('shows no level goal line when selectedSkillEta is null', () => {
    render(
      <MaterialSection
        runoutStatus={baseRunout}
        selectedSkillEta={null}
        xpPerCycle={4}
      />
    );
    expect(screen.queryByText(/for Lv/)).not.toBeInTheDocument();
  });

  it('shows calibration countdown for warming material ETA', () => {
    render(
      <MaterialSection
        runoutStatus={{ ...baseRunout, warmupRemainingMs: 300000 }}
        selectedSkillEta={null}
        xpPerCycle={4}
      />
    );
    expect(screen.getByText('Calibrating... 5m 0s')).toBeInTheDocument();
  });

  it('works correctly with big bones (xpPerCycle 12)', () => {
    render(
      <MaterialSection
        runoutStatus={{ ...baseRunout, itemId: 'bigBones', totalMaterial: 10 }}
        selectedSkillEta={{ targetLevel: 7, xpNeeded: 120 }}
        xpPerCycle={12}
      />
    );
    // cyclesNeeded = ceil(120/12) = 10, materialNeeded = 10, shortage = 0
    expect(screen.getByText(/Enough Big Bones for Lv 7/)).toBeInTheDocument();
  });
});
