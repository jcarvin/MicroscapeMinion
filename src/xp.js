export function computeMicroscapeXpTable() {
  const table = [0, 0];
  let points = 0;
  for (let level = 1; level <= 98; level++) {
    points += Math.floor(10 * (level + 300 * Math.pow(2, level / 7)));
    table.push(Math.floor(points / 4));
  }
  return table;
}

export function isValidXpTable(table) {
  return (
    Array.isArray(table) &&
    table.length >= 99 &&
    table[1] === 0 &&
    table[2] === 830 &&
    table[17] === 31174
  );
}

export function getLevelFromXp(xp, xpTable) {
  if (xpTable.length < 3) return 1;

  let lo = 1;
  let hi = xpTable.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (xpTable[mid] <= xp) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(1, hi);
}
