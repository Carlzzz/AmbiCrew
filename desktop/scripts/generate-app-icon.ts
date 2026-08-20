/**
 * 一次性脚本：把白色 logomark（透明底 + 白圆 + 镂空 A）合成一张
 * "白圆填满 + 蓝色 A + 圆外透明" 的 1024×1024 PNG 源图，
 * 作为 `tauri icon` 的输入。
 *
 * 设计思路（对齐 Chrome 桌面图标的做法）：
 *   - 白圆是实色背景（跟 Chrome 的彩色圆盘一样）
 *   - A 字形填 Ambilight 品牌蓝 #003D7D（前景 logo）
 *   - 圆盘外保持透明（让 Windows 看着是圆形图标）
 *   - 结果：任何桌面/主题下都稳定，不会因为 .ico 的 alpha 限制变成黑底
 *
 * 用法：
 *   bun run scripts/generate-app-icon.ts
 *
 * 输入：C:/Users/songchao/Downloads/ambilight_logomark_white.png
 * 输出：desktop/app-icon.png（1024×1024）
 *
 * 后续：
 *   bunx @tauri-apps/cli icon app-icon.png
 * 会自动生成 32x32/128x128/128x128@2x/icon.icns/icon.ico 到 src-tauri/icons/。
 */
import sharp from 'sharp'
import path from 'node:path'

const SOURCE = 'C:/Users/songchao/Downloads/ambilight_logomark_white.png'
const OUTPUT = path.resolve(import.meta.dir, '..', 'app-icon.png')

const CANVAS_SIZE = 1024
// A 字形填的颜色（Ambilight 品牌蓝）
const A_COLOR = { r: 0x00, g: 0x3d, b: 0x7d }

// 1. 读源图并找出非透明像素的 bounding box（去掉四周透明留白）
const rawIn = await sharp(SOURCE).raw().toBuffer({ resolveWithObject: true })
const { data: srcData, info: srcInfo } = rawIn
let minX = srcInfo.width
let minY = srcInfo.height
let maxX = -1
let maxY = -1
for (let y = 0; y < srcInfo.height; y++) {
  for (let x = 0; x < srcInfo.width; x++) {
    const alpha = srcData[(y * srcInfo.width + x) * srcInfo.channels + 3]
    if (alpha! > 0) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
}
const cropW = maxX - minX + 1
const cropH = maxY - minY + 1
console.log(`[step 1] cropped logo region: ${cropW}x${cropH} from ${srcInfo.width}x${srcInfo.height}`)

// 2. crop 到 logo 实际区域，然后放大到 CANVAS_SIZE × CANVAS_SIZE
const scaled = await sharp(SOURCE)
  .extract({ left: minX, top: minY, width: cropW, height: cropH })
  .resize(CANVAS_SIZE, CANVAS_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .raw()
  .toBuffer({ resolveWithObject: true })

// 3. 把 "白圆内 + 原本透明" 的像素填成 A_COLOR
//    白圆判定：以画布中心为圆心，以画布短边一半为半径的圆内
const cx = CANVAS_SIZE / 2
const cy = CANVAS_SIZE / 2
const radius = CANVAS_SIZE / 2
const radiusSquared = radius * radius

const out = Buffer.from(scaled.data)
const channels = scaled.info.channels

let filledPixels = 0
for (let y = 0; y < CANVAS_SIZE; y++) {
  for (let x = 0; x < CANVAS_SIZE; x++) {
    const idx = (y * CANVAS_SIZE + x) * channels
    const alpha = out[idx + 3]
    if (alpha === 0) {
      // 只处理圆内的透明像素，圆外保持透明
      const dx = x - cx + 0.5
      const dy = y - cy + 0.5
      if (dx * dx + dy * dy <= radiusSquared) {
        out[idx] = A_COLOR.r
        out[idx + 1] = A_COLOR.g
        out[idx + 2] = A_COLOR.b
        out[idx + 3] = 255
        filledPixels++
      }
    }
  }
}
console.log(`[step 2] filled ${filledPixels} pixels (A shape) with #${A_COLOR.r.toString(16).padStart(2, '0')}${A_COLOR.g.toString(16).padStart(2, '0')}${A_COLOR.b.toString(16).padStart(2, '0')}`)

// 4. 写出 PNG
await sharp(out, { raw: { width: CANVAS_SIZE, height: CANVAS_SIZE, channels: channels as 4 } })
  .png()
  .toFile(OUTPUT)

console.log(`[done] wrote ${OUTPUT}`)
console.log(`  canvas: ${CANVAS_SIZE}x${CANVAS_SIZE}, white circle fills canvas, A filled with brand blue #003D7D`)
console.log(`  next: bunx @tauri-apps/cli icon app-icon.png`)
