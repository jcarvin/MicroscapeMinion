import { useState, useRef } from 'react';
import styled from 'styled-components';
import { formatItemId } from '../utils/format';
import useClickOutside from '../hooks/useClickOutside';

const ComboCount = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.muted};
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
  background: ${({ $selected }) => $selected ? 'rgba(91,141,238,.2)' : 'transparent'};

  &:hover {
    background: ${({ theme }) => theme.accent};
    color: #fff;
  }
  &:hover ${ComboCount} { color: rgba(255,255,255,.7); }
`;

const ComboOptions = styled.ul`
  position: absolute;
  top: calc(100% + 3px);
  left: 0;
  min-width: 180px;
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: ${({ theme }) => theme.radius};
  list-style: none;
  margin: 0;
  padding: 3px 0;
  z-index: 50;
  max-height: 140px;
  overflow-y: auto;
  box-shadow: 0 4px 12px rgba(0,0,0,.4);
`;

const ComboEmpty = styled.li`
  padding: 5px 9px;
  font-size: 12px;
  color: ${({ theme }) => theme.muted};
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
  const wrapRef = useRef(null);

  useClickOutside(wrapRef, () => setIsOpen(false));

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
      {isOpen && (
        <ComboOptions data-testid="combo-options">
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
        </ComboOptions>
      )}
    </ComboWrap>
  );
}
