import { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { formatItemId } from '../utils/format';
import useClickOutside from '../hooks/useClickOutside';

const ComboCount = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.brown500};
  flex-shrink: 0;
`;

const ComboOption = styled.li`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 9px;
  cursor: pointer;
  font-size: 12px;
  gap: 8px;
  background: ${({ $selected }) => $selected ? 'rgba(78,133,41,.15)' : 'transparent'};
  color: ${({ theme }) => theme.brown900};

  &:hover {
    background: ${({ theme }) => theme.accent};
    color: ${({ theme }) => theme.text};
  }
  &:hover ${ComboCount} { color: rgba(245,229,189,.7); }
`;

const ComboOptions = styled.ul`
  position: fixed;
  min-width: 180px;
  background: ${({ theme }) => theme.parchmentLight};
  border: 2px solid ${({ theme }) => theme.brown700};
  border-radius: ${({ theme }) => theme.radius};
  list-style: none;
  margin: 0;
  padding: 3px 0;
  z-index: 9999;
  max-height: 140px;
  overflow-y: auto;
  box-shadow: 3px 3px 0 rgba(0,0,0,0.3);
`;

const ComboEmpty = styled.li`
  padding: 5px 9px;
  font-size: 12px;
  color: ${({ theme }) => theme.brown500};
  font-style: italic;
`;

export const ComboWrap = styled.div`
  position: relative;
  min-width: 0;

  input {
    width: 100%;
    cursor: pointer;
  }
`;

function itemName(item) {
  return item.name && item.name !== item.id ? item.name : formatItemId(item.id);
}

export default function ItemCombobox({ items, selectedId, onSelect, onConfirm, inputRef }) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [dropStyle, setDropStyle] = useState({});
  const wrapRef = useRef(null);

  useClickOutside(wrapRef, () => setIsOpen(false));

  useLayoutEffect(() => {
    if (!isOpen || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const dropdownHeight = 140;
    const gap = 3;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    if (spaceBelow >= dropdownHeight || spaceBelow >= rect.top - gap) {
      setDropStyle({ top: rect.bottom + gap, left: rect.left, minWidth: rect.width });
    } else {
      setDropStyle({ bottom: window.innerHeight - rect.top + gap, left: rect.left, minWidth: rect.width, top: 'auto' });
    }
  }, [isOpen]);

  function handleFocus() {
    if (items.length > 0) { setFilter(''); setIsOpen(true); }
  }

  function handleBlur() {
    setTimeout(() => setIsOpen(false), 150);
  }

  function handleChange(e) {
    setFilter(e.target.value);
    setIsOpen(true);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') { setIsOpen(false); e.target.blur(); }
    else if (e.key === 'Enter') {
      const exact = filtered.find((item) => itemName(item).toLowerCase() === filter.trim().toLowerCase());
      const match = exact ?? (filtered.length === 1 ? filtered[0] : null);
      if (match) onSelect(match.id);
      else onConfirm?.();
      setIsOpen(false);
    }
  }

  function handleOptionMouseDown(e, itemId) {
    e.preventDefault();
    onSelect(itemId);
    setIsOpen(false);
  }

  const selectedItem = items.find(({ id }) => id === selectedId);
  const displayValue = isOpen
    ? filter
    : (selectedItem ? itemName(selectedItem) : (selectedId ? formatItemId(selectedId) : ''));

  const q = filter.toLowerCase().replace(/\s+/g, '');
  const filtered = q
    ? items.filter((item) => itemName(item).toLowerCase().replace(/\s+/g, '').includes(q))
    : items;

  return (
    <ComboWrap ref={wrapRef}>
      <input
        ref={inputRef}
        type="text"
        placeholder="Select item"
        autoComplete="off"
        spellCheck={false}
        value={displayValue}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {isOpen && createPortal(
        <ComboOptions data-testid="combo-options" style={dropStyle}>
          {filtered.length === 0 ? (
            <ComboEmpty>
              {items.length === 0 ? 'No items available' : 'No match'}
            </ComboEmpty>
          ) : (
            filtered.map(item => (
              <ComboOption
                key={item.id}
                $selected={item.id === selectedId}
                onMouseDown={e => handleOptionMouseDown(e, item.id)}
              >
                <span>{itemName(item)}</span>
                <ComboCount>{item.count}</ComboCount>
              </ComboOption>
            ))
          )}
        </ComboOptions>,
        document.body
      )}
    </ComboWrap>
  );
}
