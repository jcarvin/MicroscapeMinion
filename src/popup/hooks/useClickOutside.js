import { useEffect, useRef } from 'react';

export default function useClickOutside(ref, callback) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    function handleMouseDown(e) {
      if (!ref.current?.contains(e.target)) callbackRef.current();
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [ref]);
}
