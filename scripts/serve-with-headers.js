// scripts/serve-with-headers.js
// Enkel statisk server til Lighthouse CI.
// Bruges kun i CI, ikke i produktion.

import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import rateLimit from 'express-rate-limit';
import { loadNetlifyHeaders } from '../tools/generate-headers.mjs';

const PORT = process.env.PORT || process.argv[2] || 4173;
// Juster DIR hvis der findes en build-mappe. Hvis appen kører direkte fra repo-roden, lad den være som nu.
const DIR = path.resolve(process.argv[3] || process.cwd());
const IS_CI = process.env.CSSMATE_IS_CI === '1';
const HEADER_RULES = loadNetlifyHeaders();
const CSP_HEADER = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; img-src 'self' data: blob: https:; font-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://esm.sh https://www.gstatic.com https://apis.google.com https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/; connect-src 'self' https://www.googleapis.com https://*.googleapis.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseinstallations.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com https://www.gstatic.com https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/; frame-src 'self' https://accounts.google.com https://*.firebaseapp.com https://*.web.app https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests";
const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP_HEADER,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
};

const app = express();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

function matchHeadersForPath(requestPath) {
  if (!requestPath.startsWith('/')) {
    requestPath = `/${requestPath}`;
  }

  const exactMatch = HEADER_RULES.find(rule => rule.path === requestPath);
  if (exactMatch) return exactMatch.values;

  const wildcardRules = HEADER_RULES
    .filter(rule => rule.path.endsWith('/*'))
    .sort((a, b) => b.path.length - a.path.length);

  for (const rule of wildcardRules) {
    const prefix = rule.path.slice(0, -1);
    if (requestPath.startsWith(prefix)) return rule.values;
  }

  return null;
}

// Cache-politik: HTML = no-cache, assets = lang TTL + Netlify headers
app.use((req, res, next) => {
  const headerValues = matchHeadersForPath(req.path);
  if (headerValues) {
    for (const [key, value] of Object.entries(headerValues)) {
      res.setHeader(key, value);
    }
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(key, value);
  }
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
  if (html.includes('name="cssmate-is-ci"')) return html;
  const snippet = '<meta name="cssmate-is-ci" content="1">';
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
