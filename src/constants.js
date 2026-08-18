export const BANK_TRIGGER_ITEM_COUNT = 25;
export const CYCLE_SAMPLE_LIMIT = 100;
export const RATE_SAMPLE_LIMIT = 1000;
export const ETA_DEBUG_LOG_LIMIT = 2000;
export const ETA_DEBUG_LOG_VERSION = 1;
export const TICK_SAMPLE_LIMIT = 100;
// Rate-based ETA: 5-minute warmup before switching from cycle-based fallback.
// After a 5-minute gap with no samples, the window resets so idle time isn't
// counted in the elapsed denominator.
export const RATE_WARMUP_MS = 300_000;
export const GAP_RESET_MS = 300_000;
export const ETA_CALIBRATION_CACHE_VERSION = 3;
export const ETA_CALIBRATION_CACHE_KEY = 'etaCalibrationCache';
// Bank trip timing — computed dynamically from zone mapPos when ZONE_DATA is available.
// BANK_TRIP_MS is the fallback used before the bundle is parsed.
// Travel speed empirically derived: distance 325.7 / 6 ticks observed for manor-kitchen.
// Banking time (8 ticks) observed from WebSocket frame.
export const BANK_TRIP_MS = 50_000; // fallback (~50s covers most zones)
export const TRAVEL_SPEED = 54.3; // mapPos units per tick
export const BANKING_TICKS = 8; // ticks spent depositing
export const TICK_MS = 2000; // server tick duration (confirmed from bundle formula)
