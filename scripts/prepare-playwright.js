import { execSync } from 'node:child_process';

const isNetlify = process.env.NETLIFY === 'true' || process.env.NETLIFY === '1';
const skip = isNetlify || process.env.PLAYWRIGHT_SKIP_PREPARE === '1';

if (skip) {
  console.log('prepare-playwright: skipping browser install (NETLIFY or PLAYWRIGHT_SKIP_PREPARE set)');
  process.exit(0);
}

const browserTarget = process.env.PLAYWRIGHT_PREPARE_BROWSER || 'chromium';
const withDeps = process.env.PLAYWRIGHT_PREPARE_WITH_DEPS === '1';
const args = ['npx', 'playwright', 'install'];

if (withDeps) {
  args.splice(2, 0, '--with-deps');
}

args.push(browserTarget);

console.log(`prepare-playwright: installing ${browserTarget}${withDeps ? ' with dependencies' : ''}`);

execSync(args.join(' '), { stdio: 'inherit' });
