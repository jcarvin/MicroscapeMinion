import { useEffect, useId, useRef, useState } from 'react';
import { ETA_INFO_TITLE } from '../utils/format';

const TOOLTIP_DELAY_MS = 150;

export default function EtaTooltip({ delayMs = TOOLTIP_DELAY_MS }) {
  const tooltipId = useId();
  const showTimerRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);

  function clearShowTimer() {
    if (!showTimerRef.current) return;
    clearTimeout(showTimerRef.current);
    showTimerRef.current = null;
  }

  function handleShow() {
    clearShowTimer();
    showTimerRef.current = setTimeout(() => {
      showTimerRef.current = null;
      setIsOpen(true);
    }, delayMs);
  }

  function handleHide() {
    clearShowTimer();
    setIsOpen(false);
  }

  useEffect(() => clearShowTimer, []);

  return (
    <span
      className="eta-tooltip"
      onMouseEnter={handleShow}
      onMouseLeave={handleHide}
      onFocus={handleShow}
      onBlur={handleHide}
    >
      <span
        className="eta-info"
        tabIndex={0}
        aria-label="ETA estimate details"
        aria-describedby={isOpen ? tooltipId : undefined}
      >
        i
      </span>
      {isOpen ? (
        <span className="eta-tooltip-bubble" id={tooltipId} role="tooltip">
          {ETA_INFO_TITLE}
        </span>
      ) : null}
    </span>
  );
}
