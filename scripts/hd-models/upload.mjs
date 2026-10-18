/**
 * Upload HD mode's models (models/*.onnx, from prepare.py) to Vercel Blob, where
 * the HD function loads them at start-up, and record each one's URL in
 * models/manifest.json. Needs BLOB_READ_WRITE_TOKEN; without it, does nothing.
 * The weights are openly licensed and published elsewhere already, so public
 * (unlisted) Blob URLs are fine.
 */
import { put } from '@vercel/blob'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dirname, '../../models')
const token = process.env.BLOB_READ_WRITE_TOKEN
if (!token) {
  console.log('No BLOB_READ_WRITE_TOKEN: models not uploaded.')
  process.exit(0)
}
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
for (const m of manifest) {
  // The hash in the path: a new model never replaces one a running function is using.
  const pathname = `hd-models/${m.sha256.slice(0, 12)}/${m.file}`
  const body = readFileSync(join(dir, m.file))
  const options = { token, addRandomSuffix: false, allowOverwrite: true, multipart: true, contentType: 'application/octet-stream' }
  let blob
  try {
    blob = await put(pathname, body, { ...options, access: 'public' })
  } catch (e) {
    // A store set up for private files refuses public ones; the function then reads with the token.
    console.log(`Public upload refused (${e.message}); trying private.`)
    blob = await put(pathname, body, { ...options, access: 'private' })
    m.access = 'private'
  }
  m.url = blob.url
  console.log(`${m.file} → ${blob.url}`)
}
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
