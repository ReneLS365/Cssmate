import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import http from 'node:http'
import test, { before, after } from 'node:test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..')

let server

before(async () => {
  const indexContent = await readFile(join(projectRoot, 'index.html'))
  server = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(indexContent)
      return
    }

    res.writeHead(404)
    res.end()
  }).listen(5050)
})

after(() => {
  if (server) {
    server.close()
  }
})

const request = (path) =>
  new Promise((resolve, reject) => {
    const target = new URL(path)
    const clientReq = http.get(target, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
    })
    clientReq.on('error', reject)
  })

test('serves the app shell', async () => {
  const response = await request('http://localhost:5050/')
  assert.equal(response.status, 200)
  assert.ok(response.body.includes('<!DOCTYPE html>'))
})
