import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
// Copy only app assets. No tests, credentials, native journals or project configs.
await mkdir(path.join(root, 'www'), { recursive: true });
await cp(path.join(root, '../webgame'), path.join(root, 'www'), { recursive: true,
  filter: source => path.relative(path.join(root, '../webgame'), source).split(path.sep)[0] !== 'downloads' });
const index = path.join(root, 'www/index.html');
let html = await readFile(index, 'utf8');
// Native tracking and the character loader are packaged, not fetched from a CDN.
html = html.replace('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', './assets/vendor/three/build/three.module.js')
  .replace('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/', './assets/vendor/three/examples/jsm/');
await mkdir(path.join(root, 'www/assets/vendor/capacitor'), { recursive: true });
await build({ entryPoints: [path.join(root, 'scripts/native-bridge.mjs')], bundle: true, format: 'esm', platform: 'browser',
  target: 'es2022', outfile: path.join(root, 'www/assets/vendor/capacitor/native-bridge.js') });
await cp(path.join(root, 'node_modules/@capacitor/core/LICENSE'), path.join(root, 'www/assets/vendor/capacitor/LICENSE'));
await mkdir(path.join(root, 'www/assets/vendor/three/build'), { recursive: true });
await cp(path.join(root, 'node_modules/three/build/three.module.js'), path.join(root, 'www/assets/vendor/three/build/three.module.js'));
await cp(path.join(root, 'node_modules/three/examples/jsm'), path.join(root, 'www/assets/vendor/three/examples/jsm'), { recursive: true });
await cp(path.join(root, 'node_modules/three/LICENSE'), path.join(root, 'www/assets/vendor/three/LICENSE'));
await writeFile(index, html);
console.log('Packaged game and Capacitor bridge locally. Native GPS has no network dependency.');
