import { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { formatDuration } from '../utils/format';
import { EtaLabel, EtaStack } from './Shared';

const CalibratingNote = styled.span`
  color: ${({ theme }) => theme.muted};
  font-size: 10px;
  opacity: 0.72;
  white-space: nowrap;
`;

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

  if (displayMs == null) return <EtaLabel>ETA calibrating…</EtaLabel>;
  if (displayMs <= 0) {
    return (
      <EtaLabel>
        {complete === false ? 'ETA <1s' : doneLabel}
      </EtaLabel>
    );
  }

  const tripNote = bankTrips > 0
    ? ` (+${bankTrips} bank trip${bankTrips > 1 ? 's' : ''})`
    : '';

  return (
    <EtaStack>
      <EtaLabel>ETA {formatDuration(displayMs)}{tripNote}</EtaLabel>
      {displayWarmupMs > 0 && (
        <CalibratingNote>Calibrating... {formatDuration(displayWarmupMs)}</CalibratingNote>
      )}
    </EtaStack>
  );
}
