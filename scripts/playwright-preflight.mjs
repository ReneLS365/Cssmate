import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

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

async function main() {
  const browser = process.env.PLAYWRIGHT_BROWSER || 'chromium';
  const installWithDeps = process.env.PLAYWRIGHT_INSTALL_WITH_DEPS === '1';
  const installArgs = ['playwright', 'install'];
  if (installWithDeps) installArgs.push('--with-deps');
  installArgs.push(browser);

  console.log(`[playwright:preflight] Ensuring ${browser} is installed${installWithDeps ? ' with OS dependencies' : ''}.`);
  await run('npx', installArgs);

  const artifactDir = path.resolve('reports/playwright-preflight');
  const artifactPath = path.join(artifactDir, `${browser}-preflight.png`);
  await mkdir(artifactDir, { recursive: true });

  console.log(`[playwright:preflight] Launch probe for ${browser} browser runtime.`);
  try {
    await run('npx', ['playwright', 'screenshot', '--browser', browser, '--device=Pixel 5', 'about:blank', artifactPath]);
  } catch (error) {
    console.error('[playwright:preflight] Browser launch probe failed.');
    console.error('[playwright:preflight] Install missing Linux deps with: npx playwright install --with-deps chromium');
    throw error;
  } finally {
    await rm(artifactPath, { force: true });
  }

  console.log('[playwright:preflight] OK: browser install and launch probe succeeded.');
}

main().catch((error) => {
  console.error(`[playwright:preflight] FAIL: ${error.message}`);
  process.exit(1);
});
