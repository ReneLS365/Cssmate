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
const IS_CI = Boolean(process.env.CI);

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

function safeResolve (filePath) {
  const normalized = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  const resolved = path.resolve(DIR, normalized);
  return resolved.startsWith(DIR) ? resolved : null;
}

function sendHtml (res, targetPath) {
  const html = readFileSync(targetPath, 'utf8');
  res.type('html').send(injectCiFlag(html));
}

if (IS_CI) {
  app.get('/', (req, res) => {
    sendHtml(res, path.join(DIR, 'index.html'));
  });

  app.get(/\.html$/, (req, res, next) => {
    const resolved = safeResolve(req.path);
    if (!resolved || !existsSync(resolved)) {
      next();
      return;
    }
    sendHtml(res, resolved);
  });
}

app.use(express.static(DIR, { extensions: ['html'] }));

app.get('*', (req, res) => {
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
