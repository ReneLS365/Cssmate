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

  const performanceMin = Number(process.env.CSSMATE_LH_PERF_MIN ?? 95);
  const lcpMaxMs = Number(process.env.CSSMATE_LH_LCP_MAX_MS ?? 3000);
  const clsMax = Number(process.env.CSSMATE_LH_CLS_MAX ?? 0.01);

  const thresholds = {
    performance: { min: performanceMin },
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
  } else if (lcpMs > lcpMaxMs) {
    failures.push(`LCP: ${(lcpMs / 1000).toFixed(2)}s (max ${(lcpMaxMs / 1000).toFixed(2)}s)`);
  }

  const clsValue = getAuditValue(report, 'cumulative-layout-shift');
  if (clsValue === null) {
    failures.push('CLS: missing value');
  } else if (clsValue > clsMax) {
    failures.push(`CLS: ${clsValue.toFixed(2)} (max ${clsMax.toFixed(2)})`);
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
