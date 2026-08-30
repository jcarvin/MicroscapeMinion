import { useCallback, useRef } from 'react';

export default function useNthClick(n, callback, timeoutMs = 600) {
  const countRef = useRef(0);
  const timerRef = useRef(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  return useCallback(() => {
    countRef.current += 1;
    clearTimeout(timerRef.current);
    if (countRef.current >= n) {
      countRef.current = 0;
      callbackRef.current?.();
    } else {
      timerRef.current = setTimeout(() => {
        countRef.current = 0;
      }, timeoutMs);
    }
  }, [n, timeoutMs]);
}
