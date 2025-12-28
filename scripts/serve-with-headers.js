// scripts/serve-with-headers.js
// Enkel statisk server til Lighthouse CI.
// Bruges kun i CI, ikke i produktion.

import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import rateLimit from 'express-rate-limit';

const PORT = process.env.PORT || process.argv[2] || 4173;
// Juster DIR hvis der findes en build-mappe. Hvis appen kører direkte fra repo-roden, lad den være som nu.
const DIR = path.resolve(process.argv[3] || process.cwd());
const IS_CI = process.env.CSSMATE_IS_CI === '1';

const app = express();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// Cache-politik: HTML = no-cache, assets = lang TTL
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else {
    // 1 år, ok til fingerprintede filer
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  next();
});

app.use(limiter);

function injectCiFlag (html) {
  if (!IS_CI) return html;
  if (html.includes('window.CSSMATE_IS_CI')) return html;
  const snippet = '<script>window.CSSMATE_IS_CI = true;</script>';
  if (html.includes('</head>')) {
    return html.replace('</head>', `${snippet}\n</head>`);
  }
  return `${snippet}\n${html}`;
}

function normalizeRelPath (requestPath) {
  if (typeof requestPath !== 'string') return null;
  const trimmed = requestPath.split('?')[0].split('#')[0];
  const withoutLeadingSlash = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  const fallback = withoutLeadingSlash === '' ? 'index.html' : withoutLeadingSlash;
  let decoded;
  try {
    decoded = decodeURIComponent(fallback);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const segments = decoded.split('/');
  if (segments.some(segment => segment === '..')) return null;
  return decoded;
}

function safeResolve (filePath) {
  if (!filePath) return null;
  const resolved = path.resolve(DIR, filePath);
  const relative = path.relative(DIR, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function sendHtml (res, targetPath) {
  const html = readFileSync(targetPath, 'utf8');
  res.type('html').send(injectCiFlag(html));
}

if (IS_CI) {
  app.get('/', (req, res) => {
    const resolved = safeResolve(normalizeRelPath(req.path));
    if (!resolved) {
      res.sendStatus(400);
      return;
    }
    sendHtml(res, resolved);
  });

  app.get(/\.html$/, (req, res, next) => {
    const normalized = normalizeRelPath(req.path);
    if (!normalized || !normalized.endsWith('.html')) {
      next();
      return;
    }
    const resolved = safeResolve(normalized);
    if (!resolved || !existsSync(resolved)) {
      next();
      return;
    }
    sendHtml(res, resolved);
  });
}

app.use(express.static(DIR, { extensions: ['html'] }));

app.get(/.*/, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  if (IS_CI) {
    sendHtml(res, path.join(DIR, 'index.html'));
    return;
  }
  res.sendFile(path.join(DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`serve-with-headers: serving ${DIR} on http://127.0.0.1:${PORT}`);
});
