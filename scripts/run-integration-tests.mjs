import { spawn } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

const INTEGRATION_ROOT = path.resolve('tests/integration');

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectIntegrationTests(rootDir) {
  const files = [];

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (entry.isFile() && /\.(test|spec)\.(c|m)?js$/u.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  await walk(rootDir);
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function runNodeTests(files) {
  return new Promise((resolve, reject) => {
    const args = ['--import', './tests/test-setup.js', '--test', '--test-force-exit', ...files];
    const child = spawn(process.execPath, args, { stdio: 'inherit' });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`integration tests failed with exit code ${code ?? 'unknown'}`));
    });
  });
}

async function main() {
  const hasIntegrationDir = await exists(INTEGRATION_ROOT);
  if (!hasIntegrationDir) {
    console.log('[test:integration] No dedicated integration directory found: tests/integration');
    console.log('[test:integration] Skipping integration run with explicit empty-suite result.');
    return;
  }

  const files = await collectIntegrationTests(INTEGRATION_ROOT);
  if (files.length === 0) {
    console.log('[test:integration] tests/integration exists but has no *.test.js/*.spec.js files.');
    console.log('[test:integration] Skipping integration run with explicit empty-suite result.');
    return;
  }

  console.log(`[test:integration] Running ${files.length} integration test file(s):`);
  for (const file of files) {
    console.log(` - ${path.relative(process.cwd(), file)}`);
  }

  await runNodeTests(files);
}

main().catch((error) => {
  console.error(`[test:integration] FAIL: ${error.message}`);
  process.exit(1);
});
