import path from 'node:path'

export function resolveLocalPath (...parts) {
  return path.join(process.cwd(), ...parts)
}
