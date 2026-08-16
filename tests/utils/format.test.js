import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatItemId,
  formatSkillName,
  formatNumber,
  fmtHMS,
} from '../../src/popup/utils/format';

describe('formatDuration', () => {
  it('formats seconds only', () => {
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(59000)).toBe('59s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(3599000)).toBe('59m 59s');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3600000)).toBe('1h 0m');
    expect(formatDuration(3661000)).toBe('1h 1m');
    expect(formatDuration(7260000)).toBe('2h 1m');
  });
});

describe('formatItemId', () => {
  it('splits camelCase into title case', () => {
    expect(formatItemId('woodLog')).toBe('Wood Log');
    expect(formatItemId('copperOre')).toBe('Copper Ore');
  });

  it('handles a single lowercase word', () => {
    expect(formatItemId('stone')).toBe('Stone');
  });
});

describe('formatSkillName', () => {
  it('converts dashes and underscores to spaces, title-cased', () => {
    expect(formatSkillName('wood-cutting')).toBe('Wood Cutting');
    expect(formatSkillName('attack_strength')).toBe('Attack Strength');
    expect(formatSkillName('defense')).toBe('Defense');
  });

  it('handles null/undefined gracefully', () => {
    expect(formatSkillName(null)).toBe('');
    expect(formatSkillName(undefined)).toBe('');
  });
});

describe('formatNumber', () => {
  it('adds locale separators', () => {
    expect(formatNumber(1000)).toBe('1,000');
    expect(formatNumber(1000000)).toBe('1,000,000');
  });

  it('handles null/undefined as zero', () => {
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber(undefined)).toBe('0');
  });
});

describe('fmtHMS', () => {
  it('returns HH:MM:SS format', () => {
    expect(fmtHMS(Date.now())).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
