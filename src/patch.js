// jsondiffpatch patch application.
//
// Patch format (confirmed from live frames):
//   Initial state: top-level values wrapped in [value] arrays.
//   Delta updates follow jsondiffpatch: [current] = added; [previous, current] = modified; [old, 0, 0] = deleted.
//   Array-typed fields (e.g. toasts) use jsondiffpatch _t:"a" format.

export function applyPatch(base, delta) {
  if (delta === null || delta === undefined) return delta;

  // jsondiffpatch delete marker: [oldValue, 0, 0] → remove the key
  if (
    Array.isArray(delta) &&
    delta.length === 3 &&
    delta[1] === 0 &&
    delta[2] === 0
  ) {
    return undefined;
  }
  // Scalar/initial delta:
  //   [current] = add/initial value
  //   [previous, current] = modified value
  if (Array.isArray(delta)) {
    if (delta.length === 1) return delta[0];
    if (delta.length === 2) return delta[1];
    return delta.length > 0 ? delta[0] : undefined;
  }

  // jsondiffpatch array delta (_t:"a") — used for ordered lists like toasts
  if (typeof delta === 'object' && delta._t === 'a') {
    const arr = Array.isArray(base) ? [...base] : [];
    const delIdxs = Object.keys(delta)
      .filter((k) => k !== '_t' && k.startsWith('_'))
      .map((k) => parseInt(k.slice(1), 10))
      .sort((a, b) => b - a);
    for (const i of delIdxs) {
      const d = delta[`_${i}`];
      if (Array.isArray(d) && d.length >= 1) arr.splice(i, 1);
    }
    for (const key of Object.keys(delta)) {
      if (key === '_t' || key.startsWith('_')) continue;
      const i = parseInt(key, 10);
      if (isNaN(i)) continue;
      const d = delta[key];
      if (Array.isArray(d) && d.length === 1) arr.splice(i, 0, d[0]);
      else arr[i] = applyPatch(arr[i], d);
    }
    return arr;
  }

  // Object delta — merge keys recursively
  if (typeof delta === 'object') {
    const result =
      base && typeof base === 'object' && !Array.isArray(base)
        ? { ...base }
        : {};
    for (const [k, v] of Object.entries(delta)) {
      const applied = applyPatch(result[k], v);
      if (applied === undefined) delete result[k];
      else result[k] = applied;
    }
    return result;
  }

  return delta;
}
