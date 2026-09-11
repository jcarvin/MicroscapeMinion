import { useEffect } from 'react';

// Closes a modal on Escape key. Click-outside is handled by the overlay's
// onClick (e.target === e.currentTarget) so that portal-rendered dropdowns
// inside the dialog don't accidentally trigger dismissal via document.mousedown.
export default function useModalDismiss(onClose) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
}
