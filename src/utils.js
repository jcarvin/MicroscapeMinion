export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function isReasonableMs(value) {
  return (
    typeof value === 'number' &&
    isFinite(value) &&
    value >= 250 &&
    value <= 60 * 60_000
  );
}

export function isReasonableTickMs(value) {
  return typeof value === 'number' && value > 500 && value < 10_000;
}
