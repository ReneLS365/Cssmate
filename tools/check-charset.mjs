import { readFileSync } from 'node:fs';
import path from 'node:path';

const inputPath = process.argv[2] || 'index.html';
const resolvedPath = path.resolve(process.cwd(), inputPath);
const html = readFileSync(resolvedPath, 'utf8');

const headSlice = html.slice(0, 1024).toLowerCase();
const charsetMatch = headSlice.match(/<meta\s+[^>]*charset=["']?utf-8["']?/i);
const httpEquivMatch = html.match(/<meta\s+http-equiv=["']content-type["']\s+content=["']text\/html;\s*charset=utf-8["']\s*\/?>/i);

if (!charsetMatch) {
  throw new Error(`charset meta not found early in ${inputPath}`);
}

if (!httpEquivMatch) {
  throw new Error(`http-equiv Content-Type meta missing in ${inputPath}`);
}

console.log(`charset checks passed for ${inputPath}`);
