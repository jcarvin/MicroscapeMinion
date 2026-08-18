import { useRef } from 'react';

export default function Header({ connected, idle, onToggleDebug }) {
  let dotClass = 'dot';
  if (connected) dotClass += idle ? ' idle' : ' connected';

  const clickCountRef = useRef(0);
  const clickTimerRef = useRef(null);

  function handleDotClick() {
    clickCountRef.current += 1;
    clearTimeout(clickTimerRef.current);
    if (clickCountRef.current >= 3) {
      clickCountRef.current = 0;
      onToggleDebug?.();
    } else {
      clickTimerRef.current = setTimeout(() => {
        clickCountRef.current = 0;
      }, 600);
    }
  }

  return (
    <div className="header">
      <span className={dotClass} onClick={handleDotClick} style={{ cursor: 'pointer' }} />
      <span className="brand">Microscape Minion</span>
    </div>
  );
}
