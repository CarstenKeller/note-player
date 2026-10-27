import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// the recognition (Kotlin, compiled to JavaScript by `gradle :omr-core:jsBrowserProductionLibraryDistribution`)
const omrCore = fileURLToPath(new URL('../omr-core/build/dist/js/productionLibrary/omr-core.mjs', import.meta.url));

const build = process.env.VITE_BUILD ?? 'dev';
// changes only when the recognition changes; a sheet is then recognized again
const engine = process.env.VITE_ENGINE ?? build;

/**
 * Emits sw.js, a service worker that stores all files of the app for offline use. The list of
 * files and the build name are written into it, so every build replaces the old cache.
 */
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const publicDir = fileURLToPath(new URL('./public', import.meta.url));
      const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [relative(publicDir, p)];
      });
      const files = ['./', ...Object.keys(bundle), ...walk(publicDir)]
        .filter((f) => !f.endsWith('.map'))
        .map((f) => (f === './' ? f : './' + f.split('\\').join('/')));
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: SW_SOURCE.replace('__BUILD__', JSON.stringify(build)).replace('__FILES__', JSON.stringify(files)),
      });
    },
  };
}

const SW_SOURCE = `
const CACHE = 'notenspieler-' + __BUILD__;
const FILES = __FILES__;
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // the page itself: the newest from the network, the stored one offline
    e.respondWith(fetch(req).catch(() => caches.match('./', { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
`;

export default defineConfig({
  base: './',
  plugins: [preact(), serviceWorker()],
  resolve: { alias: { 'omr-core': omrCore } },
  define: { __BUILD__: JSON.stringify(build), __ENGINE__: JSON.stringify(engine) },
  worker: { format: 'es' },
  build: { target: 'safari15', sourcemap: false, chunkSizeWarningLimit: 2000 },
});
