const VALID_EXPR = /^[0-9+\-*/.,()%\s×÷]*$/

function hasBalancedParentheses (expr) {
  let depth = 0
  for (const char of expr) {
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth < 0) return false
    }
  }
  return depth === 0
}

export function evaluateExpression (expr) {
  if (typeof expr !== 'string') expr = String(expr ?? '')
  const trimmed = expr.trim()
  if (!trimmed) return 0

  if (!VALID_EXPR.test(trimmed)) {
    throw new Error('Invalid characters in expression')
  }
  if (!hasBalancedParentheses(trimmed)) {
    throw new Error('Unbalanced parentheses')
  }

  const normalized = trimmed
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/,/g, '.')
    .replace(/%/g, '/100')

  // Efter validering er Function sikkert da udtrykket kun indeholder simple tal/operatører
  // eslint-disable-next-line no-new-func
  const fn = new Function('"use strict"; return (' + normalized + ')')
  const result = Number(fn())
  if (!Number.isFinite(result)) {
    throw new Error('Expression result is not finite')
  }
  return result
}
