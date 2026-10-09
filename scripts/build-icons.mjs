// Renders design/icon-source.png (operator-provided 1254×1254 PNG) into the
// PWA + iOS home-screen icon variants in public/. Run with
// `node scripts/build-icons.mjs` (requires sharp). The PNG source is the
// canonical brand artwork. It lives outside public/ so the 2 MB original is
// never deployed; only the generated sizes are.
//
// The icons are written as palette PNGs (256 colors, dithered). For this
// artwork that is visually lossless and about a quarter of the size of a
// truecolor PNG, which matters because the service worker precaches them
// on every install.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const publicDir = resolve(rootDir, 'public')

const SOURCE = resolve(rootDir, 'design', 'icon-source.png')

const TARGETS = [
  { out: 'icon-192.png', size: 192 },
  { out: 'icon-512.png', size: 512 },
  { out: 'apple-touch-icon.png', size: 180 }
]

async function main() {
  const src = await readFile(SOURCE)
  for (const t of TARGETS) {
    const buf = await sharp(src)
      .resize(t.size, t.size, { fit: 'cover', position: 'center' })
      .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
      .toBuffer()
    await writeFile(resolve(publicDir, t.out), buf)
    console.log(`wrote public/${t.out} (${t.size}×${t.size}, ${buf.length} bytes)`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
