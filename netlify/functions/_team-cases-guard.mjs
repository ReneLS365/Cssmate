import { isProd } from './_context.mjs'

const TEAM_CASES_SQL_FORBIDDEN = [
  /\bproject_id\b/i,
  /\bFROM\s+cases\b/i,
  /\bRETURNING\s+id\b/i,
]

export const TEAM_CASES_SCHEMA_INFO = {
  table: 'public.team_cases',
  primaryKey: 'case_id',
  teamKey: 'team_id',
}

export function guardTeamCasesSql(sql, context = 'team_cases') {
  if (isProd()) return sql
  const match = TEAM_CASES_SQL_FORBIDDEN.find(pattern => pattern.test(sql))
  if (match) {
    throw new Error(`[team_cases] forbidden SQL (${context}): ${match}`)
  }
  return sql
}
