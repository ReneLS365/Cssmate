import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const reportDir = path.join(process.cwd(), 'reports', 'lighthouse');
const defaultReportPath = path.join(reportDir, 'mobile.json');
const runReportPaths = [1, 2, 3].map(index => path.join(reportDir, `mobile-run${index}.json`));

function formatScore(value) {
  return Number.isFinite(value) ? Math.round(value) : 'N/A';
}

function readReport(reportPath) {
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

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function loadReports() {
  const existingRuns = runReportPaths.filter(reportPath => existsSync(reportPath));
  if (existingRuns.length === 3) {
    return { reportPaths: existingRuns, warning: null };
  }

  if (existsSync(defaultReportPath)) {
    const warning = 'Only one LH report found. For stable results, run 3 passes.';
    return { reportPaths: [defaultReportPath], warning };
  }

  if (existingRuns.length > 0) {
    const warning = 'Partial LH reports found. For stable results, run 3 passes.';
    return { reportPaths: existingRuns, warning };
  }

  throw new Error('No Lighthouse reports found.');
}

function formatMetricList(values, formatter) {
  return values.map(value => formatter(value)).join(', ');
}

function formatAuditLine(audit) {
  const score = Number.isFinite(audit.score) ? audit.score.toFixed(2) : 'N/A';
  const numericValue = Number.isFinite(audit.numericValue) ? audit.numericValue.toFixed(2) : 'N/A';
  const displayValue = audit.displayValue ?? 'N/A';
  return `- ${audit.id}: ${audit.title} | score=${score} | numericValue=${numericValue} | displayValue=${displayValue}`;
}

function collectAuditDiagnostics(report) {
  const audits = report?.audits ?? {};
  const auditList = Object.entries(audits).map(([id, audit]) => ({
    id,
    title: audit?.title ?? id,
    score: audit?.score,
    scoreDisplayMode: audit?.scoreDisplayMode,
    numericValue: audit?.numericValue,
    displayValue: audit?.displayValue,
    detailsType: audit?.details?.type,
  }));

  const candidates = auditList.filter(audit => {
    if (audit.scoreDisplayMode === 'numeric') return true;
    if (audit.detailsType === 'opportunity' || audit.detailsType === 'table') return true;
    return false;
  });

  const sorted = candidates.sort((a, b) => {
    const scoreA = Number.isFinite(a.score) ? a.score : 1;
    const scoreB = Number.isFinite(b.score) ? b.score : 1;
    if (scoreA !== scoreB) return scoreA - scoreB;
    const valueA = Number.isFinite(a.numericValue) ? a.numericValue : 0;
    const valueB = Number.isFinite(b.numericValue) ? b.numericValue : 0;
    return valueB - valueA;
  });

  const topOffenders = sorted.slice(0, 8);
  const spotlightIds = [
    'largest-contentful-paint',
    'total-blocking-time',
    'speed-index',
    'interactive',
    'mainthread-work-breakdown',
    'bootup-time',
    'unused-javascript',
    'render-blocking-resources',
    'unminified-javascript',
    'unminified-css',
    'uses-text-compression',
  ];

  const spotlight = spotlightIds
    .map(id => audits[id])
    .filter(Boolean)
    .map(audit => ({
      id: audit.id,
      title: audit.title,
      score: audit.score,
      scoreDisplayMode: audit.scoreDisplayMode,
      numericValue: audit.numericValue,
      displayValue: audit.displayValue,
      detailsType: audit.details?.type,
    }));

  return { topOffenders, spotlight };
}

function formatCategoryScore(score) {
  if (!Number.isFinite(score)) return 'N/A';
  return Math.round(score * 100);
}

function getCategoryScores(report) {
  const categories = report?.categories ?? {};
  return {
    performance: formatCategoryScore(categories.performance?.score),
    accessibility: formatCategoryScore(categories.accessibility?.score),
    'best-practices': formatCategoryScore(categories['best-practices']?.score),
    seo: formatCategoryScore(categories.seo?.score),
    pwa: formatCategoryScore(categories.pwa?.score),
  };
}

function formatDetailsItem(item) {
  if (typeof item === 'string') return item;
  try {
    return JSON.stringify(item);
  } catch {
    return String(item);
  }
}

function collectBestPracticesFailures(report) {
  const bpCategory = report?.categories?.['best-practices'];
  const auditRefs = bpCategory?.auditRefs ?? [];
  const audits = report?.audits ?? {};

  const failing = auditRefs
    .map(ref => audits[ref.id])
    .filter(audit => audit && audit.score !== 1 && audit.score !== null)
    .map(audit => ({
      id: audit.id,
      title: audit.title,
      score: audit.score,
      displayValue: audit.displayValue,
      detailsItems: Array.isArray(audit.details?.items) ? audit.details.items.slice(0, 3) : [],
    }));

  return failing.sort((a, b) => {
    const scoreA = Number.isFinite(a.score) ? a.score : 1;
    const scoreB = Number.isFinite(b.score) ? b.score : 1;
    return scoreA - scoreB;
  });
}

async function writeLighthouseArtifacts(report) {
  const artifactsDir = path.join(process.cwd(), '.artifacts');
  mkdirSync(artifactsDir, { recursive: true });
  const jsonPath = path.join(artifactsDir, 'lighthouse.report.json');
  const htmlPath = path.join(artifactsDir, 'lighthouse.report.html');

  writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  try {
    const { ReportGenerator } = await import('lighthouse/report/generator/report-generator.js');
    const html = ReportGenerator.generateReport(report, 'html');
    writeFileSync(htmlPath, html);
  } catch (error) {
    console.log(`⚠️ Could not generate HTML report: ${error?.message || error}`);
  }
}

async function main() {
  const { reportPaths, warning } = loadReports();
  const reports = reportPaths.map(reportPath => readReport(reportPath));

  const performanceMin = Number(process.env.CSSMATE_LH_PERF_MIN ?? 95);
  const performanceTarget = Number(process.env.CSSMATE_LH_PERF_TARGET ?? 100);
  const lcpMaxMs = Number(process.env.CSSMATE_LH_LCP_MAX_MS ?? 3000);
  const clsMax = Number(process.env.CSSMATE_LH_CLS_MAX ?? 0.01);

  const sampleReport = reports[0];
  const testedUrl = sampleReport?.finalUrl || sampleReport?.requestedUrl || 'unknown';
  const isCi = Boolean(process.env.CI || process.env.CSSMATE_IS_CI);

  console.log(`Node: ${process.version}`);
  console.log(`URL: ${testedUrl}`);
  console.log(`CI: ${isCi ? 'true' : 'false'}`);

  if (warning) {
    console.log(`⚠️ ${warning}`);
  }

  const thresholds = {
    performance: { min: performanceMin },
    'best-practices': { min: 100, exact: true },
    accessibility: { min: 98 },
    seo: { min: 100, exact: true },
  };

  const failures = [];
  const perfScores = reports.map(report => getCategoryScore(report, 'performance')).filter(score => score !== null);
  const lcpValues = reports.map(report => getAuditValue(report, 'largest-contentful-paint')).filter(value => value !== null);
  const clsValues = reports.map(report => getAuditValue(report, 'cumulative-layout-shift')).filter(value => value !== null);

  const perfMedian = median(perfScores);
  const lcpMedian = median(lcpValues);
  const clsMedian = median(clsValues);

  if (perfScores.length) {
    const perfList = formatMetricList(perfScores, value => formatScore(value));
    console.log(`Lighthouse perf runs: ${perfList} (median ${formatScore(perfMedian)}, min ${performanceMin}, target ${performanceTarget})`);
    if (perfMedian !== null && perfMedian < performanceTarget) {
      console.warn(`⚠️ Lighthouse performance below preferred target (${formatScore(perfMedian)} < ${performanceTarget}).`);
    }
  }

  if (lcpValues.length) {
    const lcpList = formatMetricList(lcpValues, value => `${(value / 1000).toFixed(2)}s`);
    console.log(`Lighthouse LCP runs: ${lcpList} (median ${(lcpMedian / 1000).toFixed(2)}s, max ${(lcpMaxMs / 1000).toFixed(2)}s)`);
  }

  if (clsValues.length) {
    const clsList = formatMetricList(clsValues, value => value.toFixed(2));
    console.log(`Lighthouse CLS runs: ${clsList} (median ${clsMedian.toFixed(2)}, max ${clsMax.toFixed(2)})`);
  }

  if (!perfScores.length) {
    failures.push('performance: missing score');
  } else if (perfMedian < performanceMin) {
    failures.push(`performance: ${formatScore(perfMedian)} (median min ${performanceMin})`);
  }

  for (const [key, rule] of Object.entries(thresholds)) {
    if (key === 'performance') {
      continue;
    }
    const score = getCategoryScore(sampleReport, key);
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

  if (!lcpValues.length) {
    failures.push('LCP: missing value');
  } else if (lcpMedian > lcpMaxMs) {
    failures.push(`LCP: ${(lcpMedian / 1000).toFixed(2)}s (median max ${(lcpMaxMs / 1000).toFixed(2)}s)`);
  }

  if (!clsValues.length) {
    failures.push('CLS: missing value');
  } else if (clsMedian > clsMax) {
    failures.push(`CLS: ${clsMedian.toFixed(2)} (median max ${clsMax.toFixed(2)})`);
  }

  if (failures.length) {
    console.log('❌ Lighthouse FAILED');
    failures.forEach(entry => {
      console.log(`- ${entry}`);
    });
    const categoryScores = getCategoryScores(sampleReport);
    console.log('Category scores:');
    console.log(`- performance: ${categoryScores.performance}`);
    console.log(`- accessibility: ${categoryScores.accessibility}`);
    console.log(`- best-practices: ${categoryScores['best-practices']}`);
    console.log(`- seo: ${categoryScores.seo}`);
    console.log(`- pwa: ${categoryScores.pwa}`);

    const bestPracticesFailures = collectBestPracticesFailures(sampleReport);
    if (bestPracticesFailures.length) {
      console.log('Best Practices failing audits:');
      bestPracticesFailures.forEach(audit => {
        const score = Number.isFinite(audit.score) ? audit.score.toFixed(2) : 'N/A';
        const displayValue = audit.displayValue ?? 'N/A';
        console.log(`- ${audit.id}: ${audit.title} | score=${score} | displayValue=${displayValue}`);
        if (audit.detailsItems.length) {
          audit.detailsItems.forEach((item, index) => {
            console.log(`  item ${index + 1}: ${formatDetailsItem(item)}`);
          });
        }
      });
    }

    if (perfMedian !== null && perfMedian < performanceMin) {
      const { topOffenders, spotlight } = collectAuditDiagnostics(sampleReport);
      if (topOffenders.length) {
        console.log('Top audit offenders:');
        topOffenders.forEach(audit => {
          console.log(formatAuditLine(audit));
        });
      }
      if (spotlight.length) {
        console.log('Spotlight audits:');
        spotlight.forEach(audit => {
          console.log(formatAuditLine(audit));
        });
      }
    }

    await writeLighthouseArtifacts(sampleReport);
    process.exit(1);
  }

  console.log('✅ Lighthouse PASSED');
}

main().catch(error => {
  console.log(`❌ Lighthouse check failed: ${error?.message || error}`);
  process.exit(1);
});
