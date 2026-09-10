import { useCallback } from 'react';
import { setZonePreference } from '../utils/messages';

export default function useZonePreferenceWriter() {
  return useCallback((activityId, entityId, zoneId) => {
    setZonePreference(activityId, entityId, zoneId);
  }, []);
}
