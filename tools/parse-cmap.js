/**
 * 行屿 - 解析 TTF 字体 cmap 表，枚举可用的图标字形 codepoint
 * 用法：node tools/parse-cmap.js <font.ttf> [输出文件]
 * 输出：PUA 区（0xE000-0xF8FF）内有字形的 codepoint，空格分隔的 hex
 */
const fs = require('fs')

const file = process.argv[2]
const outFile = process.argv[3]
if (!file) {
  console.error('usage: node tools/parse-cmap.js <font.ttf> [out.txt]')
  process.exit(1)
}

const buf = fs.readFileSync(file)
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

const numTables = dv.getUint16(4)
let cmapOff = -1
for (let i = 0; i < numTables; i++) {
  const rec = 12 + i * 16
  const tag = String.fromCharCode(
    dv.getUint8(rec), dv.getUint8(rec + 1), dv.getUint8(rec + 2), dv.getUint8(rec + 3)
  )
  if (tag === 'cmap') {
    cmapOff = dv.getUint32(rec + 8)
    break
  }
}
if (cmapOff < 0) {
  console.error('cmap table not found')
  process.exit(1)
}

const glyphs = new Set()
const numSub = dv.getUint16(cmapOff + 2)
for (let i = 0; i < numSub; i++) {
  const rec = cmapOff + 4 + i * 8
  const offset = dv.getUint32(rec + 4)
  const sub = cmapOff + offset
  const format = dv.getUint16(sub)

  if (format === 4) {
    const segCount = dv.getUint16(sub + 6) >> 1
    const endCodes = sub + 14
    const startCodes = endCodes + segCount * 2 + 2
    const idDeltas = startCodes + segCount * 2
    const idRangeOffsets = idDeltas + segCount * 2
    for (let s = 0; s < segCount; s++) {
      const start = dv.getUint16(startCodes + s * 2)
      const end = dv.getUint16(endCodes + s * 2)
      const delta = dv.getInt16(idDeltas + s * 2)
      const ro = dv.getUint16(idRangeOffsets + s * 2)
      for (let cp = start; cp <= end; cp++) {
        let gid
        if (ro === 0) {
          gid = (cp + delta) & 0xffff
        } else {
          const idx = idRangeOffsets + s * 2 + ro + (cp - start) * 2
          const g = dv.getUint16(idx)
          gid = g === 0 ? 0 : (g + delta) & 0xffff
        }
        if (gid !== 0) glyphs.add(cp)
        if (cp === 0xffff) break
      }
    }
  } else if (format === 12) {
    const nGroups = dv.getUint32(sub + 12)
    for (let g = 0; g < nGroups; g++) {
      const rec = sub + 16 + g * 12
      const startChar = dv.getUint32(rec)
      const endChar = dv.getUint32(rec + 4)
      const startGlyph = dv.getUint32(rec + 8)
      if (endChar < 0xe000 || startChar > 0xf8ff) continue // 只关心 PUA
      for (let cp = startChar; cp <= endChar; cp++) {
        if (startGlyph + (cp - startChar) !== 0) glyphs.add(cp)
      }
    }
  }
}

const list = Array.from(glyphs)
  .filter((cp) => cp >= 0xe000 && cp <= 0xf8ff)
  .sort((a, b) => a - b)

const line = list.map((cp) => cp.toString(16).toUpperCase().padStart(4, '0')).join(' ')
if (outFile) {
  fs.writeFileSync(outFile, line)
  console.error('wrote ' + list.length + ' PUA glyphs to ' + outFile)
} else {
  console.log(line)
  console.error('total PUA glyphs: ' + list.length)
}
