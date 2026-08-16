import '@testing-library/jest-dom';

globalThis.chrome = {
  runtime: { sendMessage: vi.fn(), lastError: null },
  storage: {
    local: {
      get: vi.fn((_keys, callback) => callback({})),
      set: vi.fn(),
    },
  },
};
