import '@testing-library/jest-dom';

globalThis.chrome = {
  runtime: {
    getURL: vi.fn((path) => path),
    lastError: null,
    onMessage: { addListener: vi.fn() },
    sendMessage: vi.fn(),
  },
  storage: {
    local: {
      get: vi.fn((_keys, callback) => callback({})),
      remove: vi.fn(),
      set: vi.fn(),
    },
    session: {
      get: vi.fn((_keys, callback) => callback({})),
      remove: vi.fn(),
      set: vi.fn(),
    },
  },
  notifications: { create: vi.fn() },
  tabs: { sendMessage: vi.fn(() => Promise.resolve()) },
};
