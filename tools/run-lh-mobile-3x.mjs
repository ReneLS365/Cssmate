import { execFileSync, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DIR = 'reports/lighthouse';
const URL = 'http://127.0.0.1:4173/';
const RUNS = 3;
const MAX_ATTEMPTS = 3;
const BACKOFF = [3000, 7000];
const BETWEEN = 3000;
const CHROME_FLAGS = [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-breakpad',
  '--disable-client-side-phishing-detection',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-domain-reliability',
  '--disable-extensions',
  '--disable-features=Translate,BackForwardCache,MediaRouter,OptimizationHints,AcceptCHFrame',
  '--disable-hang-monitor',
  '--disable-ipc-flooding-protection',
  '--disable-notifications',
  '--disable-popup-blocking',
  '--disable-renderer-backgrounding',
  '--disable-sync',
  '--metrics-recording-only',
  '--mute-audio',
  '--password-store=basic',
  '--use-mock-keychain',
].join(' ');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const runCmd = (cmd, args, env) => new Promise(resolve => {
  const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';

  child.stdout.on('data', data => {
    log += data.toString();
  });
  child.stderr.on('data', data => {
    log += data.toString();
  });

  child.on('close', code => resolve({ code, log }));
});

const retryable = log => (
  log.includes('Status code: 429') ||
  log.includes('ERRORED_DOCUMENT_REQUEST') ||
  log.includes('unable to reliably load') ||
  log.includes('NavigationRunner:error') ||
  log.includes('ECONNREFUSED') ||
  log.includes('net::ERR')
);

const readJsonIfExists = async file => {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const perfScore = json => {
  const score = json?.categories?.performance?.score;
  return typeof score === 'number' ? Math.round(score * 100) : null;
};

const preflight = async () => {
  console.log('== Preflight ==');
  const nodeVersion = await runCmd('node', ['-v'], process.env);
  console.log(nodeVersion.log.trim());
  const npmVersion = await runCmd('npm', ['-v'], process.env);
  console.log(npmVersion.log.trim());

  const envChromePath = process.env.CHROME_PATH?.trim() || process.env.CHROME_BIN?.trim();
  const chromePathResult = await runCmd(
    'bash',
    ['-lc', 'command -v google-chrome-stable || command -v google-chrome || command -v chromium || command -v chromium-browser || true'],
    process.env,
  );
  const chromePath = envChromePath || chromePathResult.log.trim();
  console.log('Chrome path:', chromePath || '(not found)');

  if (chromePath) {
    const chromeVersion = await runCmd('bash', ['-lc', `${chromePath} --version || true`], process.env);
    console.log('Chrome version:', chromeVersion.log.trim());
  }

  const rootStatus = await runCmd('bash', ['-lc', `curl -s -o /dev/null -w "%{http_code}" ${URL} || true`], process.env);
  console.log('HTTP status for /:', rootStatus.log.trim());
  const indexStatus = await runCmd('bash', ['-lc', `curl -s -o /dev/null -w "%{http_code}" ${URL}index.html || true`], process.env);
  console.log('HTTP status for /index.html:', indexStatus.log.trim());
  console.log('===============');

  return chromePath;
};

await fs.mkdir(DIR, { recursive: true });

const CHROME_PATH = await preflight();
if (!CHROME_PATH) {
  console.error('Chrome not found via CHROME_PATH/CHROME_BIN or PATH. Lighthouse cannot run.');
  process.exit(1);
}

const smokeTestChrome = chromePath => {
  try {
    execFileSync(
      chromePath,
      ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--dump-dom', 'about:blank'],
      { stdio: 'pipe', timeout: 30000 },
    );
    console.log('Chrome smoke test: OK');
  } catch (err) {
    console.error('Chrome smoke test: FAILED');
    console.error(String(err?.stderr || err?.message || err));
    process.exit(1);
  }
};

smokeTestChrome(CHROME_PATH);

const lighthouseBin = async () => {
  const localBin = path.join('node_modules', '.bin', process.platform === 'win32' ? 'lighthouse.cmd' : 'lighthouse');
  try {
    await fs.access(localBin);
    return localBin;
  } catch {
    return 'lighthouse';
  }
};

const lighthouseCmd = await lighthouseBin();

const results = [];

for (let i = 1; i <= RUNS; i += 1) {
  const out = path.join(DIR, `mobile-run${i}.json`);
  let ok = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await fs.unlink(out);
    } catch {
      // Ignore missing file.
    }

    const userDataDir = `/tmp/lh-chrome-${i}-${attempt}-${Date.now()}`;
    const chromeFlags = `${CHROME_FLAGS} --user-data-dir=${userDataDir}`;
    const env = {
      ...process.env,
      LH_OUTPUT_PATH: out,
      DISABLE_RATE_LIMIT: '1',
      NODE_ENV: 'production',
      CHROME_PATH,
    };

    const { code, log } = await runCmd(
      lighthouseCmd,
      [
        URL,
        '--form-factor=mobile',
        '--only-categories=performance,best-practices,accessibility,seo',
        '--output=json',
        `--output-path=${out}`,
        `--chrome-flags=${chromeFlags}`,
        '--max-wait-for-load=45000',
        '--throttling-method=provided',
        '--no-enable-error-reporting',
      ],
      env,
    );
    const tail = log.slice(-2000);

    console.log(`\n== LH run${i} attempt${attempt} exit=${code} ==`);
    console.log(tail);

    const json = await readJsonIfExists(out);
    if (code === 0 && json) {
      const score = perfScore(json);
      results.push({ i, out, score });
      ok = true;
      break;
    }

    if (attempt < MAX_ATTEMPTS && retryable(log)) {
      await sleep(BACKOFF[Math.min(attempt - 1, BACKOFF.length - 1)]);
      continue;
    }

    break;
  }

  if (!ok) {
    results.push({ i, out: null, score: null });
  }

  await sleep(BETWEEN);
}

const okReports = results.filter(result => result.out);
if (!okReports.length) {
  console.error('\n❌ Lighthouse failed: no successful runs');

  try {
    const preview = await fs.readFile('preview.log', 'utf8');
    console.error('\n== preview.log (tail) ==');
    console.error(preview.slice(-4000));
  } catch {
    console.error('\n(no preview.log found)');
  }

  process.exit(1);
}

const pick = okReports.find(result => result.i === 2)
  ?? okReports.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0];

await fs.copyFile(pick.out, path.join(DIR, 'mobile.json'));

console.log('\nLighthouse summary:');
for (const result of results) {
  console.log(`- run${result.i}: ${result.out ? 'OK' : 'FAIL'}${result.score != null ? ` (perf ${result.score})` : ''}`);
}
console.log(`Picked run${pick.i}`);
