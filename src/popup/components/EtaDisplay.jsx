import { useState, useEffect, useRef } from 'react';
import { formatDuration } from '../utils/format';

export default function EtaDisplay({ etaMs, bankTrips = 0, doneLabel = 'Done!' }) {
  const anchorRef = useRef(null);
  const [displayMs, setDisplayMs] = useState(etaMs);

  // Re-anchor whenever the upstream etaMs value changes
  useEffect(() => {
    if (etaMs != null && etaMs > 0) {
      anchorRef.current = { etaMs, at: Date.now() };
    } else {
      anchorRef.current = null;
    }
    setDisplayMs(etaMs);
  }, [etaMs]);

  // Tick every second while there's an active anchor
  useEffect(() => {
    if (etaMs == null || etaMs <= 0) return;
    const id = setInterval(() => {
      if (!anchorRef.current) return;
      const remaining = Math.max(0, anchorRef.current.etaMs - (Date.now() - anchorRef.current.at));
      setDisplayMs(remaining);
    }, 1000);
    return () => clearInterval(id);
  }, [etaMs]);

  if (displayMs == null) return <span className="eta-label">ETA calibrating…</span>;
  if (displayMs <= 0)    return <span className="eta-label">{doneLabel}</span>;

  const tripNote = bankTrips > 0
    ? ` (+${bankTrips} bank trip${bankTrips > 1 ? 's' : ''})`
    : '';

  return <span className="eta-label">ETA {formatDuration(displayMs)}{tripNote}</span>;
}
