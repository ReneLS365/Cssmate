import fs from 'node:fs'
import path from 'node:path'

function walk (dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      walk(filePath, out)
    } else if (filePath.endsWith('.mjs') || filePath.endsWith('.js')) {
      out.push(filePath)
    }
  }
  return out
}

const root = path.join(process.cwd(), 'netlify', 'functions')
if (!fs.existsSync(root)) process.exit(0)

const files = walk(root)
const offenders = []

for (const filePath of files) {
  const content = fs.readFileSync(filePath, 'utf8')
  if (content.includes('import.meta')) offenders.push(filePath)
}

if (offenders.length) {
  console.error('❌ import.meta found in Netlify functions (breaks CJS bundling):')
  for (const filePath of offenders) console.error(' -', filePath)
  process.exit(1)
}

console.log('✅ No import.meta in netlify/functions')
