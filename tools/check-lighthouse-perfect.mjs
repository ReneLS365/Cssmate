import { readFileSync } from 'node:fs';
import path from 'node:path';

const reportPath = path.join(process.cwd(), 'reports', 'lighthouse', 'mobile.json');

function formatScore(value) {
  return Number.isFinite(value) ? Math.round(value) : 'N/A';
}

function readReport() {
  const raw = readFileSync(reportPath, 'utf8');
  return JSON.parse(raw);
}

function getCategoryScore(report, key) {
  const score = report?.categories?.[key]?.score;
  if (!Number.isFinite(score)) return null;
  return score * 100;
}

function getAuditValue(report, key) {
  const value = report?.audits?.[key]?.numericValue;
  if (!Number.isFinite(value)) return null;
  return value;
}

function main() {
  const report = readReport();

  const thresholds = {
    performance: { min: 98 },
    'best-practices': { min: 100, exact: true },
    accessibility: { min: 98 },
    seo: { min: 100, exact: true },
  };

  const failures = [];

  for (const [key, rule] of Object.entries(thresholds)) {
    const score = getCategoryScore(report, key);
    if (score === null) {
      failures.push(`${key}: missing score`);
      continue;
    }
    if (rule.exact && score !== rule.min) {
      failures.push(`${key}: ${formatScore(score)} (must be ${rule.min})`);
      continue;
    }
    if (!rule.exact && score < rule.min) {
      failures.push(`${key}: ${formatScore(score)} (min ${rule.min})`);
    }
  }

  const lcpMs = getAuditValue(report, 'largest-contentful-paint');
  if (lcpMs === null) {
    failures.push('LCP: missing value');
  } else if (lcpMs > 2500) {
    failures.push(`LCP: ${(lcpMs / 1000).toFixed(2)}s (max 2.50s)`);
  }

  const clsValue = getAuditValue(report, 'cumulative-layout-shift');
  if (clsValue === null) {
    failures.push('CLS: missing value');
  } else if (clsValue > 0.01) {
    failures.push(`CLS: ${clsValue.toFixed(2)} (max 0.01)`);
  }

  if (failures.length) {
    console.log('❌ Lighthouse FAILED');
    failures.forEach(entry => {
      console.log(`- ${entry}`);
    });
    process.exit(1);
  }

  console.log('✅ Lighthouse PASSED');
}

main();
