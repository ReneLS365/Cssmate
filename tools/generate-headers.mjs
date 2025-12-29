import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_NETLIFY_TOML = path.resolve(process.cwd(), 'netlify.toml')
const DEFAULT_HEADERS_OUTPUT = path.resolve(process.cwd(), '_headers')

function parseQuotedValue(raw) {
  const match = raw.match(/"(.*)"/)
  return match ? match[1] : ''
}

export function parseNetlifyHeaders(tomlContents) {
  const lines = tomlContents.split(/\r?\n/)
  const blocks = []
  let current = null
  let inValues = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('[[headers]]')) {
      if (current) blocks.push(current)
      current = { path: '', values: {} }
      inValues = false
      continue
    }

    if (!current) continue

    if (trimmed.startsWith('for =')) {
      current.path = parseQuotedValue(trimmed)
      continue
    }

    if (trimmed === '[headers.values]') {
      inValues = true
      continue
    }

    if (trimmed.startsWith('[')) {
      inValues = false
      continue
    }

    if (inValues) {
      const valueMatch = trimmed.match(/^([A-Za-z0-9-]+)\s*=\s*"(.*)"\s*$/)
      if (valueMatch) {
        const [, key, value] = valueMatch
        current.values[key] = value
      }
    }
  }

  if (current) blocks.push(current)

  return blocks.filter(block => block.path && Object.keys(block.values).length)
}

export function loadNetlifyHeaders(tomlPath = DEFAULT_NETLIFY_TOML) {
  const raw = readFileSync(tomlPath, 'utf8')
  return parseNetlifyHeaders(raw)
}

export function buildHeadersFile(blocks) {
  const lines = []
  for (const block of blocks) {
    lines.push(block.path)
    for (const [key, value] of Object.entries(block.values)) {
      lines.push(`  ${key}: ${value}`)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd() + '\n'
}

export function writeHeadersFile(blocks, outputPath = DEFAULT_HEADERS_OUTPUT) {
  const payload = buildHeadersFile(blocks)
  writeFileSync(outputPath, payload, 'utf8')
  return outputPath
}

function runCli() {
  const blocks = loadNetlifyHeaders()
  if (!blocks.length) {
    console.warn('Ingen [[headers]] blocks fundet i netlify.toml')
  }
  const outputPath = writeHeadersFile(blocks)
  console.log(`Skrev Netlify headers til ${outputPath}`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli()
}
