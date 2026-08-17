import { useState, useEffect, useRef } from 'react';
import { formatDuration } from '../utils/format';

export default function EtaDisplay({
  etaMs,
  bankTrips = 0,
  doneLabel = 'Done!',
  complete = null,
  warmupRemainingMs = 0,
}) {
  const anchorRef = useRef(null);
  const warmupAnchorRef = useRef(null);
  const [displayMs, setDisplayMs] = useState(etaMs);
  const [displayWarmupMs, setDisplayWarmupMs] = useState(warmupRemainingMs);

  // Re-anchor whenever the upstream etaMs value changes
  useEffect(() => {
    if (etaMs != null && etaMs > 0) {
      anchorRef.current = { etaMs, at: Date.now() };
    } else {
      anchorRef.current = null;
    }
    setDisplayMs(etaMs);
  }, [etaMs]);

  useEffect(() => {
    if (warmupRemainingMs != null && warmupRemainingMs > 0) {
      warmupAnchorRef.current = { warmupRemainingMs, at: Date.now() };
    } else {
      warmupAnchorRef.current = null;
    }
    setDisplayWarmupMs(warmupRemainingMs ?? 0);
  }, [warmupRemainingMs]);

  // Tick every second while there's an active anchor
  useEffect(() => {
    if ((etaMs == null || etaMs <= 0) && (!warmupRemainingMs || warmupRemainingMs <= 0)) return;
    const id = setInterval(() => {
      const now = Date.now();
      if (anchorRef.current) {
        const remaining = Math.max(0, anchorRef.current.etaMs - (now - anchorRef.current.at));
        setDisplayMs(remaining);
      }
      if (warmupAnchorRef.current) {
        const remaining = Math.max(
          0,
          warmupAnchorRef.current.warmupRemainingMs - (now - warmupAnchorRef.current.at)
        );
        setDisplayWarmupMs(remaining);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [etaMs, warmupRemainingMs]);

  if (displayMs == null) return <span className="eta-label">ETA calibrating…</span>;
  if (displayMs <= 0) {
    return (
      <span className="eta-label">
        {complete === false ? 'ETA <1s' : doneLabel}
      </span>
    );
  }

  const tripNote = bankTrips > 0
    ? ` (+${bankTrips} bank trip${bankTrips > 1 ? 's' : ''})`
    : '';

  return (
    <span className="eta-stack">
      <span className="eta-label">ETA {formatDuration(displayMs)}{tripNote}</span>
      {displayWarmupMs > 0 && (
        <span className="calibrating-note">Calibrating... {formatDuration(displayWarmupMs)}</span>
      )}
    </span>
  );
}
