import { spawn } from 'node:child_process';

const functionEntrypoints = [
  '../netlify/functions/api.mjs',
  '../netlify/functions/health-ping.mjs',
  '../netlify/functions/team-cases-purge.mjs',
  '../netlify/functions/backup-monthly.mjs',
  '../netlify/functions/migrate.mjs',
  '../netlify/functions/org-members.mjs',
].map((entrypoint) => new URL(entrypoint, import.meta.url).href);

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
    });

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

async function verifyFunctionImports() {
  for (const entrypoint of functionEntrypoints) {
    try {
      await import(entrypoint);
      console.log(`[smoke:build] import ok: ${entrypoint}`);
    } catch (error) {
      throw new Error(
        `[smoke:build] import failed: ${entrypoint}\n${error instanceof Error ? error.stack : String(error)}`,
      );
    }
  }
}

async function main() {
  await runCommand('npm', ['run', 'build']);
  await verifyFunctionImports();
  console.log('[smoke:build] build + function import checks passed');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
