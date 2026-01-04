import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const HTML_ENTRIES = [
  resolve(ROOT, 'index.html'),
  resolve(ROOT, 'debug', 'material-row-debug.html'),
];
const INLINE_HANDLER_REGEX = /\son[a-z]+\s*=/i;

function findInlineHandlers(contents) {
  const lines = contents.split(/\r?\n/);
  const matches = [];
  lines.forEach((line, index) => {
    if (INLINE_HANDLER_REGEX.test(line)) {
      matches.push({ line: index + 1, snippet: line.trim() });
    }
  });
  return matches;
}

async function scanFile(path) {
  try {
    const contents = await readFile(path, 'utf8');
    const matches = findInlineHandlers(contents);
    if (matches.length) {
      return { path, matches };
    }
  } catch {
    return null;
  }
  return null;
}

async function run() {
  const results = await Promise.all(HTML_ENTRIES.map(scanFile));
  const matches = results.filter(Boolean);

  if (matches.length) {
    const summary = matches
      .map(({ path, matches: fileMatches }) => {
        const lines = fileMatches
          .map(({ line, snippet }) => `  line ${line}: ${snippet}`)
          .join('\n');
        return `${path}\n${lines}`;
      })
      .join('\n');
    console.error(
      `[guard-no-inline-event-handlers] Inline event handler(s) detected:\n${summary}\n` +
      'Remove inline handlers (e.g. onload=) to keep CSP strict and avoid broken CSS.'
    );
    process.exit(1);
  }

  console.log('[guard-no-inline-event-handlers] No inline event handlers detected.');
}

run();
