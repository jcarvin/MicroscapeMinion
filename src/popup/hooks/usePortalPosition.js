import { useState, useLayoutEffect } from 'react';

const DROPDOWN_HEIGHT = 140;
const GAP = 3;

// Measures the anchor element and computes a `position: fixed` style for a
// dropdown portal, flipping above the anchor when there is insufficient space
// below. Recalculates whenever isOpen changes.
export default function usePortalPosition(anchorRef, isOpen) {
  const [dropStyle, setDropStyle] = useState({});

  useLayoutEffect(() => {
    if (!isOpen || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - GAP;
    if (spaceBelow >= DROPDOWN_HEIGHT || spaceBelow >= rect.top - GAP) {
      setDropStyle({ top: rect.bottom + GAP, left: rect.left, minWidth: rect.width });
    } else {
      setDropStyle({
        bottom: window.innerHeight - rect.top + GAP,
        left: rect.left,
        minWidth: rect.width,
        top: 'auto',
      });
    }
  }, [isOpen, anchorRef]);

  return dropStyle;
}
