// scripts/serve-with-headers.js
// Enkel statisk server til Lighthouse CI.
// Bruges kun i CI, ikke i produktion.

import express from 'express';
import path from 'node:path';
import rateLimit from 'express-rate-limit';

const PORT = process.env.PORT || process.argv[2] || 4173;
// Juster DIR hvis der findes en build-mappe. Hvis appen kører direkte fra repo-roden, lad den være som nu.
const DIR = path.resolve(process.argv[3] || process.cwd());

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
app.use(express.static(DIR, { extensions: ['html'] }));

app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`serve-with-headers: serving ${DIR} on http://127.0.0.1:${PORT}`);
});
