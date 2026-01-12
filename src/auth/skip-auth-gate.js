export function shouldSkipAuthGate () {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search || '')
  const flag = params.get('skipAuthGate') || params.get('ci')
  return flag === '1' || flag === 'true'
}
