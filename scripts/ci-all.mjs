import { spawn } from 'node:child_process';

function hasEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function run(command, args, { required = true, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(`${command} ${args.join(' ')} failed with exit code ${code}`);
      if (required) {
        reject(error);
      } else {
        console.warn(`[ci:all] optional step failed: ${error.message}`);
        resolve();
      }
    });
  });
}

async function main() {
  if (hasEnv('VITE_AUTH0_DOMAIN') && hasEnv('VITE_AUTH0_CLIENT_ID') && hasEnv('VITE_AUTH0_AUDIENCE') && hasEnv('VITE_AUTH0_REDIRECT_URI') && (hasEnv('DATABASE_URL') || hasEnv('DATABASE_URL_UNPOOLED'))) {
    await run('npm', ['run', 'verify:drift']);
  } else {
    console.log('[ci:all] skipping verify:drift (required env vars not set)');
  }

  if (hasEnv('DATABASE_URL') || hasEnv('DATABASE_URL_UNPOOLED')) {
    await run('npm', ['run', 'db:verify']);
  } else {
    console.log('[ci:all] skipping db:verify (DATABASE_URL(_UNPOOLED) not set)');
  }

  await run('npm', ['run', 'lint', '--if-present']);
  await run('npm', ['run', 'test']);
  await run('npm', ['run', 'build']);
  await run('npm', ['run', 'smoke:build']);
  await run('npm', ['run', 'perf:bundle', '--if-present']);

  await run('npm', ['run', 'test:e2e'], {
    env: {
      ...process.env,
      CI: process.env.CI || '1',
    },
  });
}

main().catch((error) => {
  console.error(`[ci:all] FAIL: ${error.message}`);
  process.exit(1);
});
