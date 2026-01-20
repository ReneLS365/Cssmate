import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const searchRoots = [
  process.cwd(),
  __dirname,
  path.resolve(__dirname, '..'),
]

export function resolveLocalPath (...parts) {
  for (const root of searchRoots) {
    const candidate = path.join(root, ...parts)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return path.join(searchRoots[0], ...parts)
}
