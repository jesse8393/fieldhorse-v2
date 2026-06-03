// Renders /public/icon-source.png (operator-provided 1254×1254 PNG) into the
// PWA + iOS home-screen icon variants. Run with `node scripts/build-icons.mjs`
// (requires sharp). The PNG source is the canonical brand artwork; the SVG
// sources (icon.svg / favicon.svg) are kept as small fallbacks for browser
// tabs but the install-screen + home-screen icons all derive from the PNG.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '..', 'public')

const SOURCE = resolve(publicDir, 'icon-source.png')

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
      .png({ compressionLevel: 9 })
      .toBuffer()
    await writeFile(resolve(publicDir, t.out), buf)
    console.log(`wrote public/${t.out} (${t.size}×${t.size}, ${buf.length} bytes)`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
