import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { Page, Route, Request } from '@playwright/test'

type SharedCaseEntry = {
  caseId: string
  jobNumber: string
  status: string
  caseKind?: string
  system?: string
  updatedAt?: string
  createdAt?: string
  totals?: Record<string, number>
  attachments?: Record<string, unknown>
}

type SharedCasesFixture = {
  cases: SharedCaseEntry[]
  deleted?: string[]
}

type MockOptions = {
  fixture?: SharedCasesFixture
  conflictCaseId?: string
}

function loadFixtureFile(): SharedCasesFixture {
  const fixturePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'fixtures',
    'sharedCases.json'
  )
  const raw = readFileSync(fixturePath, 'utf-8')
  return JSON.parse(raw)
}

function cloneEntry(entry: SharedCaseEntry): SharedCaseEntry {
  return JSON.parse(JSON.stringify(entry))
}

function getLatestUpdatedAt(entries: SharedCaseEntry[]): string {
  return entries
    .map(entry => entry.updatedAt || entry.createdAt || '')
    .filter(Boolean)
    .sort()
    .pop() || new Date().toISOString()
}

function matchesPath(request: Request, regex: RegExp) {
  const url = new URL(request.url())
  return regex.exec(url.pathname)
}

export function loadSharedCasesFixture(): SharedCasesFixture {
  return loadFixtureFile()
}

export async function installSharedCasesMock(page: Page, options: MockOptions = {}) {
  const fixture = options.fixture || loadFixtureFile()
  const entries = fixture.cases.map(cloneEntry)
  const store = new Map(entries.map(entry => [entry.caseId, entry]))
  let conflictCaseId = options.conflictCaseId || ''
  let conflictUsed = false

  await page.route('**/api/teams/**', async (route: Route, request: Request) => {
    const url = new URL(request.url())
    const method = request.method()

    const accessMatch = matchesPath(request, /^\/api\/teams\/[^/]+\/access$/)
    if (accessMatch && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          team: { id: 'hulmose', name: 'hulmose' },
        }),
      })
    }

    const listMatch = matchesPath(request, /^\/api\/teams\/[^/]+\/cases$/)
    if (listMatch && method === 'GET') {
      const isDelta = url.searchParams.has('since') || url.searchParams.has('sinceId')
      if (isDelta) {
        const deleted = Array.isArray(fixture.deleted) ? fixture.deleted : []
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [],
            deleted,
            maxUpdatedAt: getLatestUpdatedAt(Array.from(store.values())),
            nextSinceId: null,
            mode: 'delta',
          }),
        })
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: Array.from(store.values()),
          nextCursor: null,
          hasMore: false,
          total: store.size,
        }),
      })
    }

    const caseMatch = matchesPath(request, /^\/api\/teams\/[^/]+\/cases\/([^/]+)$/)
    if (caseMatch && method === 'GET') {
      const caseId = caseMatch[1]
      const entry = store.get(caseId)
      if (!entry) {
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(entry) })
    }

    const auditMatch = matchesPath(request, /^\/api\/teams\/[^/]+\/cases\/[^/]+\/audit$/)
    if (auditMatch && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
    }

    const statusMatch = matchesPath(request, /^\/api\/teams\/[^/]+\/cases\/([^/]+)\/status$/)
    if (statusMatch && method === 'PATCH') {
      const caseId = statusMatch[1]
      const entry = store.get(caseId)
      if (!entry) {
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) })
      }
      if (conflictCaseId && conflictCaseId === caseId && !conflictUsed) {
        conflictUsed = true
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Konflikt: sagen er ændret.',
            case: entry,
          }),
        })
      }
      const payload = request.postDataJSON() as { status?: string; phase?: string }
      const nextStatus = payload?.status || entry.status
      const updatedEntry = {
        ...entry,
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      }
      store.set(caseId, updatedEntry)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(updatedEntry),
      })
    }

    const approveMatch = matchesPath(request, /^\/api\/teams\/[^/]+\/cases\/([^/]+)\/approve$/)
    if (approveMatch && method === 'POST') {
      const caseId = approveMatch[1]
      const entry = store.get(caseId)
      if (!entry) {
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) })
      }
      const updatedEntry = {
        ...entry,
        status: 'godkendt',
        updatedAt: new Date().toISOString(),
      }
      store.set(caseId, updatedEntry)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updatedEntry) })
    }

    const deleteMatch = matchesPath(request, /^\/api\/teams\/[^/]+\/cases\/([^/]+)$/)
    if (deleteMatch && method === 'DELETE') {
      const caseId = deleteMatch[1]
      store.delete(caseId)
      return route.fulfill({ status: 204, body: '' })
    }

    return route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unknown endpoint' }),
    })
  })

  return {
    store,
    setConflictCaseId(id: string) {
      conflictCaseId = id
      conflictUsed = false
    },
  }
}
