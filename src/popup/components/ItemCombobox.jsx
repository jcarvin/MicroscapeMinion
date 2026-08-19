import { useState, useEffect, useRef } from 'react';
import { formatItemId } from '../utils/format';

export default function ItemCombobox({ items, selectedId, onSelect, onConfirm, inputRef }) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleMouseDown(e) {
      if (!wrapRef.current?.contains(e.target)) setIsOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

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
    e.preventDefault(); // keep focus on input so blur doesn't fire first
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
    <div className="combobox" ref={wrapRef}>
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
        <ul className="combo-options">
          {filtered.length === 0 ? (
            <li className="combo-empty">
              {items.length === 0 ? 'No items available' : 'No match'}
            </li>
          ) : (
            filtered.map(item => (
              <li
                key={item.id}
                className={`combo-option${item.id === selectedId ? ' is-selected' : ''}`}
                onMouseDown={e => handleOptionMouseDown(e, item.id)}
              >
                <span className="combo-name">{itemName(item)}</span>
                <span className="combo-count">{item.count}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function itemName(item) {
  return item.name && item.name !== item.id ? item.name : formatItemId(item.id);
}
