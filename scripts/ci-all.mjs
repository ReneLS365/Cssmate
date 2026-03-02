import { spawn } from 'node:child_process';

function hasEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function run(command, args, { required = true, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const pretty = `${command} ${args.join(' ')}`;
    console.log(`[ci:all] -> ${pretty}`);

    const child = spawn(command, args, { stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        console.log(`[ci:all] <- PASS ${pretty}`);
        resolve();
        return;
      }

      const error = new Error(`${pretty} failed with exit code ${code}`);
      if (required) {
        reject(error);
      } else {
        console.warn(`[ci:all] <- WARN optional step failed: ${error.message}`);
        resolve();
      }
    });
  });
}

async function main() {
  console.log('[ci:all] Starting deterministic baseline verification');

  await run('npm', ['run', 'guard:deps']);
  await run('npm', ['run', 'lint', '--if-present']);

  if (hasEnv('VITE_AUTH0_DOMAIN') && hasEnv('VITE_AUTH0_CLIENT_ID') && hasEnv('VITE_AUTH0_AUDIENCE') && hasEnv('VITE_AUTH0_REDIRECT_URI') && (hasEnv('DATABASE_URL') || hasEnv('DATABASE_URL_UNPOOLED'))) {
    await run('npm', ['run', 'verify:drift']);
  } else {
    console.log('[ci:all] skipping verify:drift (requires Auth0 + DATABASE_URL env vars)');
  }

  if (hasEnv('DATABASE_URL') || hasEnv('DATABASE_URL_UNPOOLED')) {
    await run('npm', ['run', 'db:verify']);
  } else {
    console.log('[ci:all] skipping db:verify (DATABASE_URL(_UNPOOLED) not set)');
  }

  await run('npm', ['run', 'test']);
  await run('npm', ['run', 'test:integration']);
  await run('npm', ['run', 'build']);
  await run('npm', ['run', 'smoke:build']);
  await run('npm', ['run', 'test:export']);
  await run('npm', ['run', 'test:e2e']);
  await run('npm', ['run', 'perf:bundle', '--if-present'], { required: false });

  console.log('[ci:all] SUCCESS: deterministic baseline verification completed');
}

main().catch((error) => {
  console.error(`[ci:all] FAIL: ${error.message}`);
  process.exit(1);
});
