import fs from 'node:fs'

const reportPath = './.lighthouseci/lhr-0.report.json'
if (!fs.existsSync(reportPath)) {
  console.error(`Lighthouse report missing at ${reportPath}`)
  process.exit(1)
}

const input = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const scores = {
  perf: input.categories.performance.score,
  a11y: input.categories.accessibility.score,
  bp: input.categories['best-practices'].score,
  seo: input.categories.seo.score,
}

const MIN_SCORE = 0.95 // Allow slight variance between runs while keeping quality high
console.log('LH scores:', scores)
if (Object.values(scores).some((score) => score < MIN_SCORE)) {
  console.error(`Lighthouse score below required ${MIN_SCORE}`)
  process.exit(1)
}
