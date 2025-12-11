import { test } from 'node:test'
import { stat } from 'node:fs/promises'

const placeholders = [
  'public/placeholders/placeholder-akkordseddel.json',
  'public/placeholders/placeholder-akkordseddel.pdf'
]

for (const path of placeholders) {
  test(`placeholder asset exists: ${path}`, async () => {
    await stat(path)
  })
}
