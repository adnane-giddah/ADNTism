/// <reference types="vitest/config" />
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Base: '/' for a root host and the Android app; `npm run build:pages` builds for GitHub Pages (/ADNTism/).
let base = '/';

export default defineConfig({
  server: { port: 5173, host: true },
  build: { target: 'es2022', cssMinify: true, assetsInlineLimit: 0 },
  plugins: [
    {
      // GitHub Pages has no rewrites: serve the app for unknown paths via 404.html, which remembers the deep
      // link and loads the app at its root (see main.ts). .nojekyll keeps files starting with _ served.
      name: 'pages-fallback',
      apply: 'build',
      configResolved(c) {
        base = c.base;
      },
      closeBundle() {
        if (base === '/') return;
        const out = resolve(process.cwd(), 'dist');
        writeFileSync(
          resolve(out, '404.html'),
          `<!doctype html><meta charset="utf-8"><title>epsilon</title><script>try{sessionStorage.setItem('eps:deep',location.pathname+location.search+location.hash)}catch(e){}location.replace(${JSON.stringify(base)});</script>`,
        );
        writeFileSync(resolve(out, '.nojekyll'), '');
      },
    },
  ],
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    // Several suites sweep thousands of generated puzzles; under a parallel run they can exceed 5 s.
    testTimeout: 30000,
  },
});
