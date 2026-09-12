import { existsSync, readFileSync } from 'node:fs';

describe('pet sprite gallery', () => {
  const html = readFileSync('site/index.html', 'utf8');
  const petIds = [...html.matchAll(/\{ id: '([^']+)'/g)].map((match) => match[1]);

  it('lists all pets and members-only variants', () => {
    expect(petIds).toHaveLength(24);
    expect(new Set(petIds).size).toBe(24);
    expect(html.match(/member: true/g)).toHaveLength(11);
  });

  it.each(['world', 'icons'])('includes a valid %s PNG for every pet', (kind) => {
    for (const petId of petIds) {
      const path = `site/assets/${kind}/${petId}.png`;
      expect(existsSync(path), `missing ${path}`).toBe(true);
      expect(readFileSync(path).subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );
    }
  });
});
