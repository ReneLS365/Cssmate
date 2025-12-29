import { readFileSync } from 'node:fs';
import path from 'node:path';

const inputPath = process.argv[2] || 'index.html';
const resolvedPath = path.resolve(process.cwd(), inputPath);
const html = readFileSync(resolvedPath, 'utf8');

const importmapSrcPattern = /<script\b[^>]*type=["']importmap["'][^>]*\bsrc=/i;

if (importmapSrcPattern.test(html)) {
  throw new Error(`external importmap detected in ${inputPath}`);
}

console.log(`no external importmap detected in ${inputPath}`);
