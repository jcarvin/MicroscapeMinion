// Zone resolution for activity queue steps.
//
// A queue step needs a concrete zone, but most entities are hosted in several
// zones. Resolution is preference-first: activity-level beats entity-level
// beats current zone beats the sole candidate. Distance never selects — it
// only orders the dropdown so the nearest zone appears first.
//
// "Distance" is Chebyshev distance on the game's 2-D map grid (mapPos), which
// approximates travel time without needing actual path data.

function chebyshevDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

export function findZoneCandidatesForEntity({ entityId, zoneDefinitions, currentZoneId }) {
  if (!entityId || !zoneDefinitions) return [];

  const currentMapPos = zoneDefinitions[currentZoneId]?.mapPos ?? null;
  const candidates = [];

  for (const [zoneId, def] of Object.entries(zoneDefinitions)) {
    if (!def.entities?.includes(entityId)) continue;
    if (def.isDungeon) continue;
    if (def.requiredItem) continue;
    const distance = chebyshevDistance(currentMapPos, def.mapPos);
    candidates.push({ zoneId, zoneName: def.name ?? zoneId, distance });
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates;
}

// Resolution order — first match wins:
//   1. byActivityId[activityId]  — where this player last ran this activity
//   2. byEntityId[entityId]      — where this player last used this entity
//   3. currentZoneId, if it hosts the entity
//   4. The sole candidate, when there is exactly one
//   5. null / 'unresolved' — the modal must ask
export function resolveZoneForActivity({
  entityId,
  activityId,
  currentZoneId,
  learnedZonePreferences,
  zoneCandidates,
}) {
  const prefs = learnedZonePreferences ?? { byActivityId: {}, byEntityId: {} };

  const byActivity = activityId ? prefs.byActivityId?.[activityId] : null;
  if (byActivity && zoneCandidates.some(c => c.zoneId === byActivity)) {
    return { zoneId: byActivity, resolutionSource: 'activity', zoneCandidates };
  }

  const byEntity = entityId ? prefs.byEntityId?.[entityId] : null;
  if (byEntity && zoneCandidates.some(c => c.zoneId === byEntity)) {
    return { zoneId: byEntity, resolutionSource: 'entity', zoneCandidates };
  }

  if (currentZoneId && zoneCandidates.some(c => c.zoneId === currentZoneId)) {
    return { zoneId: currentZoneId, resolutionSource: 'currentZone', zoneCandidates };
  }

  if (zoneCandidates.length === 1) {
    return { zoneId: zoneCandidates[0].zoneId, resolutionSource: 'sole', zoneCandidates };
  }

  return { zoneId: null, resolutionSource: 'unresolved', zoneCandidates };
}
