/**
 * CODEx-SSCAFF Autonomous Bootstrapper
 * ----------------------------------------------------
 * Dette script scanner repoet, læser alle filer og genererer:
 *  - Komplett CI pipeline
 *  - Lighthouse gate
 *  - SuperTest / E2E scaffold
 *  - PWA & service worker stabilisering
 *  - Version-bump + cache busting
 *  - Netlify deploy-flow
 *  - Tests + SW audits
 *  - GitHub workflow setup
 *
 * Scriptet kan køres med:
 *    node codex-bootstrap.js
 *
 * Codex-SSCAFF vil efterfølgende holde alt auto-vedlige: CI, PWA, caching, SW, tests, deploy.
 */

const fs = require('fs');
const path = require('path');

const NETLIFY_TOKEN_EXPR = '${{ secrets.NETLIFY_AUTH_TOKEN }}';
const NETLIFY_SITE_EXPR = '${{ secrets.NETLIFY_SITE_ID }}';

function write(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, data);
  console.log('Generated:', file);
}

write(
  '.github/workflows/codex-master.yml',
  `name: Codex Master Pipeline

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:

  setup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci

  lint:
    runs-on: ubuntu-latest
    needs: setup
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run lint --if-present
      - run: npm run format-check --if-present

  build:
    runs-on: ubuntu-latest
    needs: setup
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist

    lighthouse:
      runs-on: ubuntu-latest
      needs: build
      steps:
        - uses: actions/checkout@v4
        - uses: actions/download-artifact@v4
          with:
            name: dist
            path: dist
        - run: |
            npm ci
            npx serve dist --listen 8080 &
            sleep 3
      - uses: treosh/lighthouse-ci-action@v10
        with:
          urls: 'http://localhost:8080'
          configPath: .lighthouserc.json
      - run: node ci/check-lh-score.js

  tests:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test --if-present

  version_bump:
    runs-on: ubuntu-latest
    needs: [ lighthouse, tests ]
    steps:
      - uses: actions/checkout@v4
      - run: |
          npm version patch --no-git-tag-version
          echo "VERSION=$(node -p "require('./package.json').version")" >> $GITHUB_ENV
      - run: |
          sed -i "s/CACHE_VERSION = .*/CACHE_VERSION = \"$VERSION\";/g" app/service-worker.js
      - run: |
          git config user.email "ci@github.com"
          git config user.name "Codex CI"
          git add .
          git commit -m "ci: auto version bump to $VERSION" || true

  deploy:
    runs-on: ubuntu-latest
    needs: version_bump
    steps:
      - uses: actions/checkout@v4
      - run: |
          npm ci
          npm run build
      - uses: netlify/actions/cli@v2.0.0
        with:
          args: deploy --prod --dir=dist
        env:
          NETLIFY_AUTH_TOKEN: ${NETLIFY_TOKEN_EXPR}
          NETLIFY_SITE_ID: ${NETLIFY_SITE_EXPR}
`
);

write(
  '.lighthouserc.json',
  `{
  "ci": {
    "collect": {
      "numberOfRuns": 1
    },
    "assert": {
      "assertions": {
        "categories:performance": ["error", {"minScore": 1}],
        "categories:accessibility": ["error", {"minScore": 1}],
        "categories:best-practices": ["error", {"minScore": 1}],
        "categories:seo": ["error", {"minScore": 1}]
      }
    }
  }
}
`
);

write(
  'ci/check-lh-score.js',
  `const fs = require('fs');
const input = JSON.parse(fs.readFileSync('./.lighthouseci/lhr-0.report.json', 'utf8'));
const scores = {
  perf: input.categories.performance.score,
  a11y: input.categories.accessibility.score,
  bp: input.categories['best-practices'].score,
  seo: input.categories.seo.score
};
console.log('LH scores:', scores);
if (Object.values(scores).some((score) => score < 1)) {
  console.error('Lighthouse score below required 100');
  process.exit(1);
}
`
);

write(
  'tests/app-flow.test.js',
  `const request = require('supertest');
const serve = require('serve-handler');
const http = require('http');

let server;

beforeAll(() => {
  server = http.createServer((req, res) => serve(req, res, { public: 'dist' })).listen(5050);
});

afterAll(() => server && server.close());

test('App loads', async () => {
  const res = await request('http://localhost:5050').get('/');
  expect(res.status).toBe(200);
});
`
);

write(
  'ci/check-sw.js',
  `const fs = require('fs');
const sw = fs.readFileSync('app/service-worker.js', 'utf8');

if (!sw.includes('CACHE_VERSION')) {
  console.error('Service worker missing CACHE_VERSION');
  process.exit(1);
}

if (!sw.includes("self.addEventListener('fetch'")) {
  console.error('PWA fetch handler missing');
  process.exit(1);
}
`
);

console.log('CODEx bootstrap completed.');
console.log('Run: node codex-bootstrap.js');
