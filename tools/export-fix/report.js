const TYPES = ['json', 'csv', 'xlsx', 'zip', 'pdf']
const STATUSES = ['ok', 'fixed', 'warning', 'error']

function createSectionSummary () {
  return STATUSES.reduce((acc, key) => ({ ...acc, [key]: 0 }), {})
}

export class FixReport {
  constructor () {
    this.sections = TYPES.reduce((acc, type) => ({ ...acc, [type]: createSectionSummary() }), {})
    this.logs = []
  }

  addResult (type, status, message) {
    if (!TYPES.includes(type)) return
    const safeStatus = STATUSES.includes(status) ? status : 'warning'
    this.sections[type][safeStatus] += 1
    if (message) {
      this.logs.push({ type, status: safeStatus, message })
    }
  }

  print () {
    console.log('Export auto-fix completed.')
    TYPES.forEach(type => {
      const summary = this.sections[type]
      const line = `${type.toUpperCase()}: ${summary.fixed} fixed, ${summary.ok} ok, ${summary.warning} warnings, ${summary.error} errors`
      console.log(line)
    })

    if (this.logs.length > 0) {
      console.log('\nDetails:')
      this.logs.forEach(entry => {
        console.log(`- [${entry.type}] ${entry.status.toUpperCase()}: ${entry.message}`)
      })
    }
  }
}
