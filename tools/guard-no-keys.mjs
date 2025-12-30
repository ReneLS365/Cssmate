import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const DIST_DIR = join(ROOT, 'dist');
const IGNORE_DIRS = new Set(['node_modules', '.git', '.netlify', 'playwright-report', 'test-results']);
const IGNORE_FILES = new Set([join(ROOT, 'tools', 'guard-no-keys.mjs')]);
const PATTERNS = [
  { label: 'Firebase API key', regex: /AIza/ },
  { label: 'Private key', regex: /-----BEGIN PRIVATE KEY-----/ },
];

async function walk(dir, { includeDist = false } = {}) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (!includeDist && entry.name === 'dist') continue;
      files.push(...await walk(fullPath, { includeDist }));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function scanFiles(files, label) {
  const findings = [];
  for (const file of files) {
    if (IGNORE_FILES.has(file)) continue;
    let contents;
    try {
      contents = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const pattern of PATTERNS) {
      if (pattern.regex.test(contents)) {
        findings.push({ file, match: pattern.label, scope: label });
      }
    }
  }
  return findings;
}

async function exists(path) {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}

async function run() {
  const repoFiles = await walk(ROOT, { includeDist: false });
  const repoFindings = await scanFiles(repoFiles, 'repo');

  let distFindings = [];
  if (await exists(DIST_DIR)) {
    const distFiles = await walk(DIST_DIR, { includeDist: true });
    distFindings = await scanFiles(distFiles, 'dist');
  }

  const allFindings = [...repoFindings, ...distFindings];
  if (allFindings.length) {
    const summary = allFindings
      .map(item => `${item.scope}: ${item.file} (${item.match})`)
      .join('\n');
    console.error(`[guard-no-keys] Secret pattern(s) detected:\n${summary}`);
    process.exit(1);
  }

  console.log('[guard-no-keys] No secret patterns detected.');
}

run();
