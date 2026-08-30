import { useEffect, useRef, useState } from 'react';

export default function useDelayedTooltip(delayMs = 150) {
  const [tooltip, setTooltip] = useState(null);
  const timerRef = useRef(null);

  function clear() {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  // value can be any truthy payload (boolean or string id); callers that need
  // multi-button discrimination pass the active id, boolean callers omit it.
  function show(value = true) {
    clear();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setTooltip(value);
    }, delayMs);
  }

  function hide() {
    clear();
    setTooltip(null);
  }

  useEffect(() => clear, []);

  return { tooltip, show, hide };
}
