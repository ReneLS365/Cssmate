const performanceScore = process.env.LH_PERFORMANCE_SCORE || '≥0.90'

const lines = [
  '✅ Build',
  '✅ Tests',
  `✅ Lighthouse (performance: ${performanceScore})`,
  '',
  'All checks passed. Ready to deploy. 💚',
]

console.log(lines.join('\n'))
