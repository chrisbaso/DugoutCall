import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outputPath = resolve(root, 'demo-web/runtime-config.js');
const serverUrl = process.env.DUGOUTCALL_PUBLIC_SERVER_URL ?? '';

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `window.DUGOUTCALL_CONFIG = ${JSON.stringify({ serverUrl }, null, 2)};\n`,
  'utf8'
);

console.log(`Wrote demo-web/runtime-config.js with serverUrl=${serverUrl || '(same origin)'}`);
