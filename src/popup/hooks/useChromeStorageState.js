import { useCallback, useEffect, useState } from 'react';

export default function useChromeStorageState(key, defaultValue) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    chrome.storage.local.get([key], (res) => {
      const stored = res[key];
      if (stored !== undefined) setValue(stored);
    });
  }, [key]);

  const set = useCallback((next) => {
    setValue(next);
    chrome.storage.local.set({ [key]: next });
  }, [key]);

  return [value, set];
}
