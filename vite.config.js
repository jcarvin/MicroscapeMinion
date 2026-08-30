import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, cpSync, mkdirSync, readdirSync } from 'fs';
import { resolve } from 'path';

function extensionPlugin(mode) {
  const isFirefox = mode === 'firefox';
  const outDir = isFirefox ? 'dist-firefox' : 'dist-chrome';
  const manifestSrc = isFirefox ? 'manifest.firefox.json' : 'manifest.json';

  return {
    name: 'extension-copy',
    transformIndexHtml(html) {
      // Chrome extensions reject crossorigin on local resources
      return html.replace(/ crossorigin/g, '');
    },
    closeBundle() {
      const dist = resolve(__dirname, outDir);

      copyFileSync(resolve(__dirname, manifestSrc), resolve(dist, 'manifest.json'));

      cpSync(resolve(__dirname, 'icons'), resolve(dist, 'icons'), { recursive: true });

      const srcDir = resolve(__dirname, 'src');
      const distSrcDir = resolve(dist, 'src');
      mkdirSync(distSrcDir, { recursive: true });
      for (const f of readdirSync(srcDir)) {
        if (f === 'popup') continue; // bundled separately by Rollup
        if (f.endsWith('.js') || f.endsWith('.json')) {
          copyFileSync(resolve(srcDir, f), resolve(distSrcDir, f));
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react({ babel: { plugins: ['babel-plugin-styled-components'] } }), extensionPlugin(mode)],
  build: {
    outDir: mode === 'firefox' ? 'dist-firefox' : 'dist-chrome',
    emptyOutDir: true,
    rollupOptions: {
      input: { popup: resolve(__dirname, 'src/popup/popup.html') },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test-setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
    clearMocks: true,
  },
}));
