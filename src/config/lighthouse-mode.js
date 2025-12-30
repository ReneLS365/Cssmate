export function isLighthouseMode() {
  try {
    return String(import.meta.env.VITE_LIGHTHOUSE || '') === '1'
  } catch {
    return false
  }
}
