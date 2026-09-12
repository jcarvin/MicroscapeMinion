import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import usePortalPosition from '../../hooks/usePortalPosition';
import useClickOutside from '../../hooks/useClickOutside';

const Trigger = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  background: transparent;
  border: 1px solid ${({ theme }) => theme.brown500};
  border-radius: ${({ theme }) => theme.radius};
  color: ${({ theme }) => theme.brown900};
  padding: 1px 5px;
  cursor: pointer;
  white-space: nowrap;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: none;
  &:hover { border-color: ${({ theme }) => theme.brown700}; }
  &:active { transform: none; box-shadow: none; }
`;

const Caret = styled.span`
  font-size: 8px;
  opacity: 0.6;
  flex-shrink: 0;
`;

const DropList = styled.ul`
  position: fixed;
  min-width: 160px;
  background: ${({ theme }) => theme.parchmentLight};
  border: 2px solid ${({ theme }) => theme.brown700};
  border-radius: ${({ theme }) => theme.radius};
  list-style: none;
  margin: 0;
  padding: 3px 0;
  z-index: 10000;
  max-height: 140px;
  overflow-y: auto;
  box-shadow: 3px 3px 0 rgba(0,0,0,0.3);
`;

const DropItem = styled.li`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  cursor: ${({ $disabled }) => $disabled ? 'not-allowed' : 'pointer'};
  font-size: 11px;
  color: ${({ $disabled, theme }) => $disabled ? theme.brown500 : theme.brown900};
  background: ${({ $selected }) => $selected ? 'rgba(78,133,41,.15)' : 'transparent'};
  opacity: ${({ $disabled }) => $disabled ? 0.6 : 1};
  &:hover { background: ${({ $disabled, theme }) => $disabled ? 'transparent' : theme.accent}; color: ${({ $disabled, theme }) => $disabled ? theme.brown500 : theme.text}; }
`;

const Hint = styled.span`
  font-size: 10px;
  color: ${({ $warn, theme }) => $warn ? '#b94a3a' : theme.brown500};
  flex-shrink: 0;
`;

// Generic portal dropdown. options: [{value, label, disabled?, hint?}]
// triggerLabel overrides what's shown on the collapsed button (defaults to selected label).
export default function PortalSelect({ options, value, onSelect, placeholder = '…', triggerLabel }) {
  const [isOpen, setIsOpen] = useState(false);
  const anchorRef = useRef(null);
  const dropStyle = usePortalPosition(anchorRef, isOpen);
  useClickOutside(anchorRef, () => setIsOpen(false));

  const selected = options?.find(o => o.value === value);
  const displayLabel = triggerLabel ?? selected?.label ?? placeholder;

  return (
    <div ref={anchorRef} style={{ display: 'inline-block' }}>
      <Trigger type="button" onClick={() => setIsOpen(v => !v)}>
        {displayLabel}
        <Caret>▾</Caret>
      </Trigger>
      {isOpen && createPortal(
        <DropList style={dropStyle}>
          {(options ?? []).map((opt) => (
            <DropItem
              key={opt.value}
              $selected={opt.value === value}
              $disabled={opt.disabled}
              onMouseDown={() => {
                if (opt.disabled) return;
                onSelect(opt.value);
                setIsOpen(false);
              }}
            >
              <span>{opt.label}</span>
              {opt.hint && <Hint $warn={opt.hintWarn}>{opt.hint}</Hint>}
            </DropItem>
          ))}
        </DropList>,
        document.body
      )}
    </div>
  );
}
