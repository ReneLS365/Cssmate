// tools/lh-enforce.js
// Læser Lighthouse-rapporten og kræver 1.0 i alle kategorier.
// Fejler hårdt med detaljeret output hvis bare én kategori er under 1.0.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const reportPath = path.resolve(__dirname, "../docs/lighthouse/latest-mobile.json");

if (!fs.existsSync(reportPath)) {
  console.error(`[SuperTest] Lighthouse report not found at: ${reportPath}`);
  console.error("[SuperTest] Sørg for at 'npm run test:lh:mobile' kører før 'test:lh:enforce'.");
  process.exit(1);
}

const raw = fs.readFileSync(reportPath, "utf8");
let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  console.error("[SuperTest] Kunne ikke parse Lighthouse JSON:", err);
  process.exit(1);
}

const TARGET_SCORES = {
  performance: 0.90,
  accessibility: 1.0,
  'best-practices': 1.0,
  seo: 1.0,
};

function enforceScores(lhr) {
  const categories = lhr.categories || {};
  const failed = [];

  for (const [id, cat] of Object.entries(categories)) {
    const score = cat?.score ?? 0;
    const minScore = TARGET_SCORES[id] ?? 1.0;

    if (score < minScore) {
      failed.push({ id, score, minScore });
    }
  }

  if (failed.length) {
    console.error('\n[SuperTest] Lighthouse-krav IKKE opfyldt.\n');
    for (const f of failed) {
      console.error(`  - ${f.id}: score ${f.score.toFixed(2)} < ${f.minScore.toFixed(2)}`);
    }
    process.exitCode = 1;
  } else {
    console.log('\n[SuperTest] Lighthouse-krav opfyldt ✅\n');
  }
}

enforceScores(data);
