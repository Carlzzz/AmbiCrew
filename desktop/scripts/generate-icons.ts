import sharp from 'sharp'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import pngToIco from 'png-to-ico'
import * as png2icons from 'png2icons'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SOURCE = path.resolve(ROOT, '..', 'docs', 'ui-clone', 'Ambilogo.jpg')
const ICONS_DIR = path.resolve(ROOT, 'src-tauri', 'icons')
const PUBLIC_DIR = path.resolve(ROOT, 'public')

async function main() {
  const src = sharp(SOURCE).ensureAlpha()

  // Generate PNGs (RGBA required by Tauri)
  const sizes: [string, number][] = [
    ['32x32.png', 32],
    ['128x128.png', 128],
    ['128x128@2x.png', 256],
  ]

  for (const [filename, size] of sizes) {
    await src.clone().resize(size, size).png().toFile(path.join(ICONS_DIR, filename))
    console.log(`  ${filename}`)
  }

  // app-icon.png for frontend
  await src.clone().resize(128, 128).png().toFile(path.join(PUBLIC_DIR, 'app-icon.png'))
  console.log('  public/app-icon.png')

  // Generate ICO (16, 32, 48, 256)
  const icoSizes = [16, 32, 48, 256]
  const icoPngs: Buffer[] = []
  for (const size of icoSizes) {
    icoPngs.push(await src.clone().resize(size, size).png().toBuffer())
  }
  const ico = await pngToIco(icoPngs)
  fs.writeFileSync(path.join(ICONS_DIR, 'icon.ico'), ico)
  console.log('  icon.ico')

  // Generate ICNS
  const png1024 = await src.clone().resize(1024, 1024).png().toBuffer()
  const icns = png2icons.createICNS(png1024, png2icons.BICUBIC2, 0)
  if (icns) {
    fs.writeFileSync(path.join(ICONS_DIR, 'icon.icns'), icns)
    console.log('  icon.icns')
  } else {
    console.error('  Failed to generate icon.icns')
    process.exit(1)
  }

  console.log('Done!')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
