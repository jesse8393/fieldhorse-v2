// Renders /public/icon.svg into PNGs used for the PWA manifest + iOS home screen.
// Run with `node scripts/build-icons.mjs` (requires sharp).
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '..', 'public')

const SOURCE = resolve(publicDir, 'icon.svg')

const TARGETS = [
  { out: 'icon-192.png', size: 192 },
  { out: 'icon-512.png', size: 512 },
  { out: 'apple-touch-icon.png', size: 180 }
]

async function main() {
  const svg = await readFile(SOURCE)
  for (const t of TARGETS) {
    const buf = await sharp(svg, { density: 384 })
      .resize(t.size, t.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
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
