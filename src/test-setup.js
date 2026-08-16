import '@testing-library/jest-dom';

globalThis.chrome = {
  runtime: { sendMessage: vi.fn(), lastError: null },
};
