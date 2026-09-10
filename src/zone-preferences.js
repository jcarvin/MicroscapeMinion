// Learned zone preferences — where a player has actually performed each
// activity and entity interaction. Used by the queue builder to pre-fill
// location choices without guessing.
//
// Two independent indices:
//   byActivityId: { activityId -> zoneId }  — most specific; beats entity
//   byEntityId:   { entityId  -> zoneId }  — generalization across activities
//
// A single observation of cook-shrimp at Manor Kitchen writes both indices.
// A brand-new cook-shark goal then defaults to Manor Kitchen because both
// share the `fire` entity — the entity index is the bridge.

const STORAGE_KEY = 'learnedZonePreferences';

export function mergeZonePreference(current, { activityId, entityId, zoneId }) {
  if (!zoneId) return current;
  const next = {
    byActivityId: { ...current.byActivityId },
    byEntityId: { ...current.byEntityId },
  };
  let changed = false;
  if (activityId && next.byActivityId[activityId] !== zoneId) {
    next.byActivityId[activityId] = zoneId;
    changed = true;
  }
  if (entityId && next.byEntityId[entityId] !== zoneId) {
    next.byEntityId[entityId] = zoneId;
    changed = true;
  }
  return changed ? next : current;
}

export function emptyZonePreferences() {
  return { byActivityId: {}, byEntityId: {} };
}

export function loadZonePreferences(callback) {
  chrome.storage.local.get([STORAGE_KEY], (res) => {
    const stored = res[STORAGE_KEY];
    if (
      stored &&
      typeof stored.byActivityId === 'object' &&
      typeof stored.byEntityId === 'object'
    ) {
      callback(stored);
    } else {
      callback(emptyZonePreferences());
    }
  });
}

export function saveZonePreferences(prefs) {
  chrome.storage.local.set({ [STORAGE_KEY]: prefs });
}
