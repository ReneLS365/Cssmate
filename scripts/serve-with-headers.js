// scripts/serve-with-headers.js
// Enkel statisk server til Lighthouse CI.
// Bruges kun i CI, ikke i produktion.

import express from 'express';
import path from 'node:path';
import zlib from 'node:zlib';

const PORT = process.env.PORT || process.argv[2] || 4173;
// Juster DIR hvis der findes en build-mappe. Hvis appen kører direkte fra repo-roden, lad den være som nu.
const DIR = process.argv[3] || path.join(process.cwd(), '');

const app = express();

const compressiblePattern = /\.(?:html?|css|js|json|txt|webmanifest|svg)$/i;

function shouldCompress (pathname = '') {
  if (!pathname || pathname === '/') return true;
  return compressiblePattern.test(pathname);
}

app.use((req, res, next) => {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  const alreadyEncoded = res.getHeader('Content-Encoding');
  if (!shouldCompress(req.path) || alreadyEncoded || !acceptEncoding.includes('gzip')) {
    return next();
  }

  const gzip = zlib.createGzip();
  res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Vary', 'Accept-Encoding');
  res.removeHeader('Content-Length');
  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = (name, value) => {
    if (String(name).toLowerCase() === 'content-length') {
      return;
    }
    return originalSetHeader(name, value);
  };

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  gzip.on('data', (chunk) => originalWrite(chunk));
  gzip.on('end', () => originalEnd());
  gzip.on('error', (err) => {
    console.error('gzip stream error', err);
    res.removeHeader('Content-Encoding');
    if (!res.headersSent) {
      res.statusCode = 500;
    }
    originalEnd();
  });

  res.write = (chunk, encoding, callback) => gzip.write(chunk, encoding, callback);
  res.end = (chunk, encoding, callback) => gzip.end(chunk, encoding, callback);
  res.on('close', () => gzip.destroy());

  next();
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

app.use(express.static(DIR, { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`serve-with-headers: serving ${DIR} on http://127.0.0.1:${PORT}`);
});
