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

const categories = [
  "performance",
  "accessibility",
  "best-practices",
  "seo",
];

const failures = [];

for (const key of categories) {
  const cat = data.categories?.[key];
  if (!cat) {
    failures.push({ key, reason: "mangler kategori i rapporten" });
    continue;
  }
  const score = Number(cat.score);
  if (Number.isNaN(score)) {
    failures.push({ key, reason: "score er ikke et tal" });
    continue;
  }
  // Kræv 1.0
  if (score < 1) {
    failures.push({
      key,
      reason: `score ${score} < 1.0`,
    });
  }
}

if (failures.length) {
  console.error("\n[SuperTest] Lighthouse-krav IKKE opfyldt. Alle kategorier skal være 1.0.\n");
  for (const fail of failures) {
    console.error(
      `  - ${fail.key}: ${fail.reason}`,
    );
  }

  // Ekstra hjælp: print top 5 audits med dårligst score per kategori
  console.error("\n[SuperTest] Udvalgte audits med issues pr. kategori:\n");
  for (const key of categories) {
    const cat = data.categories?.[key];
    if (!cat) continue;
    const audits = Object.entries(data.audits || {})
      .filter(([_, a]) => a.score !== 1 && a.score !== null && a.score !== undefined)
      .map(([id, a]) => ({
        id,
        score: a.score,
        title: a.title,
      }))
      .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
      .slice(0, 5);

    if (audits.length === 0) continue;

    console.error(`  [${key}]`);
    for (const a of audits) {
      console.error(
        `    - (${a.score}) ${a.id}: ${a.title}`,
      );
    }
    console.error("");
  }

  process.exit(1);
}

console.log("[SuperTest] Lighthouse OK – alle kategorier 1.0.");
process.exit(0);
