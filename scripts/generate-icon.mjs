/**
 * Converts images/icon.svg → images/icon.png at 128×128.
 * Requires: npm install --save-dev sharp
 * Run:      node scripts/generate-icon.mjs
 */
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const svg  = readFileSync(join(root, 'images', 'icon.svg'));

await sharp(svg)
  .resize(128, 128)
  .png()
  .toFile(join(root, 'images', 'icon.png'));

console.log('images/icon.png written (128×128)');
