import { useRef, useState } from 'react';

export default function useTransientLabel(initial, resetMs = 1500) {
  const [label, setLabel] = useState(initial);
  const timerRef = useRef(null);

  function flash(next) {
    clearTimeout(timerRef.current);
    setLabel(next);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setLabel(initial);
    }, resetMs);
  }

  return [label, flash];
}
