import { spawn } from 'node:child_process';

const E2E_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
const WAIT_TIMEOUT_MS = Number(process.env.E2E_WAIT_TIMEOUT_MS || 120000);

function run(command, args, { env = process.env, stdio = 'inherit' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with exit code ${code}`));
    });
  });
}

async function stopServer(child) {
  if (!child || child.killed) return;

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
      resolve();
    }, 8000);

    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    child.kill('SIGTERM');
  });
}

async function main() {
  console.log('[test:e2e] Step 1/4: Playwright preflight');
  await run('node', ['scripts/playwright-preflight.mjs']);

  console.log('[test:e2e] Step 2/4: Start E2E server (netlify dev)');
  const server = spawn('npm', ['run', 'e2e:serve'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: process.env.PORT || '4173',
      CSSMATE_IS_CI: process.env.CSSMATE_IS_CI || '1',
    },
  });

  try {
    console.log(`[test:e2e] Step 3/4: Wait for ${E2E_URL}`);
    await run('node', ['tools/wait-for-url.mjs', E2E_URL, String(WAIT_TIMEOUT_MS)]);

    console.log('[test:e2e] Step 4/4: Run Playwright suite');
    await run('npx', ['playwright', 'test'], {
      env: {
        ...process.env,
        E2E_BASE_URL: E2E_URL,
        PLAYWRIGHT_SKIP_WEBSERVER: '1',
        CI: process.env.CI || '1',
      },
    });
  } finally {
    console.log('[test:e2e] Cleaning up E2E server');
    await stopServer(server);
  }
}

main().catch((error) => {
  console.error(`[test:e2e] FAIL: ${error.message}`);
  process.exit(1);
});
