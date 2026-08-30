import { useEffect, useId, useRef, useState } from 'react';
import styled from 'styled-components';
import { ETA_INFO_TITLE } from '../utils/format';

const TOOLTIP_DELAY_MS = 150;

const EtaTooltipWrap = styled.span`
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
`;

const EtaInfo = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  border: 1px solid currentColor;
  border-radius: 50%;
  color: ${({ theme }) => theme.muted};
  font-size: 8px;
  font-style: italic;
  font-weight: 700;
  line-height: 1;
  cursor: default;
  flex-shrink: 0;
  user-select: none;
  opacity: 0.6;

  &:hover,
  &:focus-visible {
    color: ${({ theme }) => theme.accent};
    opacity: 1;
  }
  &:focus-visible {
    outline: 1px solid ${({ theme }) => theme.accent};
    outline-offset: 2px;
  }
`;

const EtaTooltipBubble = styled.span`
  position: absolute;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: 100;
  width: 216px;
  max-width: calc(100vw - 24px);
  padding: 7px 8px;
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: ${({ theme }) => theme.radius};
  background: ${({ theme }) => theme.tooltipBg};
  color: ${({ theme }) => theme.text};
  box-shadow: 0 6px 16px rgba(0,0,0,.45);
  font-size: 11px;
  font-style: normal;
  font-weight: 400;
  line-height: 1.35;
  text-align: left;
  white-space: normal;
  pointer-events: none;

  &::after {
    content: '';
    position: absolute;
    right: 3px;
    top: 100%;
    width: 7px;
    height: 7px;
    background: ${({ theme }) => theme.tooltipBg};
    border-right: 1px solid ${({ theme }) => theme.border};
    border-bottom: 1px solid ${({ theme }) => theme.border};
    transform: translateY(-4px) rotate(45deg);
  }
`;

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
    <EtaTooltipWrap
      onMouseEnter={handleShow}
      onMouseLeave={handleHide}
      onFocus={handleShow}
      onBlur={handleHide}
    >
      <EtaInfo
        tabIndex={0}
        aria-label="ETA estimate details"
        aria-describedby={isOpen ? tooltipId : undefined}
      >
        i
      </EtaInfo>
      {isOpen ? (
        <EtaTooltipBubble id={tooltipId} role="tooltip">
          {ETA_INFO_TITLE}
        </EtaTooltipBubble>
      ) : null}
    </EtaTooltipWrap>
  );
}
