import { useEffect, useState } from 'react';
import { getStatus } from '../utils/messages';

export default function usePolledStatus(intervalMs = 1000) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    function poll() {
      getStatus().then(s => { if (s) setStatus(s); });
    }
    poll();
    const id = setInterval(poll, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return status;
}
