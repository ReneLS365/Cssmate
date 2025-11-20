import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const reportPath = path.resolve(__dirname, '../docs/lighthouse/latest-mobile.json')

if (!fs.existsSync(reportPath)) {
  throw new Error(`Lighthouse report not found at ${reportPath}`)
}

const raw = fs.readFileSync(reportPath, 'utf8')
const data = JSON.parse(raw)
const categories = ['performance', 'accessibility', 'best-practices', 'seo']

const failing = categories.filter((key) => {
  const category = data.categories?.[key]
  return !category || Number(category.score) < 1
})

if (failing.length) {
  throw new Error(`Lighthouse scores below 1.0: ${failing.join(', ')}`)
}

console.log('All Lighthouse categories are perfect.')
