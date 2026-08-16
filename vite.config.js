import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, cpSync, mkdirSync } from 'fs';
import { resolve } from 'path';

function extensionPlugin() {
  return {
    name: 'extension-copy',
    transformIndexHtml(html) {
      // Chrome extensions reject crossorigin on local resources
      return html.replace(/ crossorigin/g, '');
    },
    closeBundle() {
      const dist = resolve(__dirname, 'dist');

      // manifest.json is unchanged — popup path "src/popup/popup.html" stays valid
      copyFileSync(resolve(__dirname, 'manifest.json'), resolve(dist, 'manifest.json'));

      cpSync(resolve(__dirname, 'icons'), resolve(dist, 'icons'), { recursive: true });

      mkdirSync(resolve(dist, 'src'), { recursive: true });
      for (const f of ['background.js', 'content.js', 'injected.js', 'activity-defs.json']) {
        copyFileSync(resolve(__dirname, 'src', f), resolve(dist, 'src', f));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), extensionPlugin()],
  build: {
    outDir: 'dist',
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
});
