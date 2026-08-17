/**
 * JPEG EXIF 解析器（纯 JS，无第三方依赖）
 *
 * 用于从照片二进制数据（ArrayBuffer）中提取拍摄 GPS 经纬度与拍摄时间。
 * 只解析 JPEG 的 APP1(Exif) 段：GPS IFD + Exif IFD(DateTimeOriginal)。
 *
 * 输入：wx.getFileSystemManager().readFile 得到的 ArrayBuffer
 * 输出：{ lng, lat, shotTime }，无 GPS 信息时 lng/lat 为 null
 *
 * 说明：微信选择相册图片时（尤其压缩图）EXIF 可能被剥离，
 * 解析失败属预期情况，由上层引导用户手动归类。
 */

const TYPE_SIZE = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  7: 1, // UNDEFINED
  9: 4, // SLONG
  10: 8 // SRATIONAL
}

/**
 * 解析 JPEG 二进制数据中的 EXIF GPS 信息
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{lng: number|null, lat: number|null, shotTime: number|null}}
 */
function parseExif(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength < 4) return empty()
  try {
    const dv = new DataView(arrayBuffer)
    // JPEG 必须以 SOI 开头
    if (dv.getUint8(0) !== 0xff || dv.getUint8(1) !== 0xd8) return empty()

    let offset = 2
    while (offset + 4 <= dv.byteLength) {
      if (dv.getUint8(offset) !== 0xff) {
        offset++
        continue
      }
      const marker = dv.getUint8(offset + 1)
      // SOS：图像数据开始，EXIF 段都已结束
      if (marker === 0xda || marker === 0xd9) break
      // 无长度的 marker
      if (marker >= 0xd0 && marker <= 0xd7) {
        offset += 2
        continue
      }
      if (marker === 0x01) {
        offset += 2
        continue
      }
      const segLen = dv.getUint16(offset + 2)
      if (segLen < 2) break
      // APP1：检查是否 Exif
      if (marker === 0xe1) {
        const segStart = offset + 4
        if (
          segStart + 6 <= dv.byteLength &&
          dv.getUint8(segStart) === 0x45 && // E
          dv.getUint8(segStart + 1) === 0x78 && // x
          dv.getUint8(segStart + 2) === 0x69 && // i
          dv.getUint8(segStart + 3) === 0x66 && // f
          dv.getUint8(segStart + 4) === 0x00 &&
          dv.getUint8(segStart + 5) === 0x00
        ) {
          const info = readTiff(dv, segStart + 6)
          if (info) return info
        }
      }
      offset += 2 + segLen
    }
    return empty()
  } catch (e) {
    return empty()
  }
}

function empty() {
  return { lng: null, lat: null, shotTime: null }
}

/**
 * 解析 TIFF 头与 IFD
 * @param {DataView} dv
 * @param {number} tiffStart 指向 'II' / 'MM'
 */
function readTiff(dv, tiffStart) {
  if (tiffStart + 8 > dv.byteLength) return null
  const byte0 = dv.getUint8(tiffStart)
  const byte1 = dv.getUint8(tiffStart + 1)
  let le // little-endian
  if (byte0 === 0x49 && byte1 === 0x49) le = true
  else if (byte0 === 0x4d && byte1 === 0x4d) le = false
  else return null

  if (dv.getUint16(tiffStart + 2, le) !== 42) return null

  const ifd0Offset = dv.getUint32(tiffStart + 4, le)
  if (tiffStart + ifd0Offset + 2 > dv.byteLength) return null

  // 遍历 IFD0，找 Exif IFD(0x8769) 与 GPS IFD(0x8825)
  let exifOffset = null
  let gpsOffset = null
  const count = dv.getUint16(tiffStart + ifd0Offset, le)
  for (let i = 0; i < count; i++) {
    const entryPos = tiffStart + ifd0Offset + 2 + i * 12
    if (entryPos + 12 > dv.byteLength) break
    const tag = dv.getUint16(entryPos, le)
    if (tag === 0x8769) {
      exifOffset = dv.getUint32(entryPos + 8, le)
    } else if (tag === 0x8825) {
      gpsOffset = dv.getUint32(entryPos + 8, le)
    }
  }

  let lat = null
  let lng = null
  let shotTime = null

  // GPS IFD
  if (gpsOffset !== null) {
    const gpsAbs = tiffStart + gpsOffset
    if (gpsAbs + 2 <= dv.byteLength) {
      const gpsCount = dv.getUint16(gpsAbs, le)
      let latRef = ''
      let lonRef = ''
      let latRaw = null
      let lonRaw = null
      for (let i = 0; i < gpsCount; i++) {
        const entryPos = gpsAbs + 2 + i * 12
        if (entryPos + 12 > dv.byteLength) break
        const tag = dv.getUint16(entryPos, le)
        const type = dv.getUint16(entryPos + 2, le)
        const countN = dv.getUint32(entryPos + 4, le)
        switch (tag) {
          case 0x0001:
            latRef = readAscii(dv, tiffStart, entryPos, le, countN)
            break
          case 0x0002:
            latRaw = readRationalArray(dv, tiffStart, entryPos, le, type, countN)
            break
          case 0x0003:
            lonRef = readAscii(dv, tiffStart, entryPos, le, countN)
            break
          case 0x0004:
            lonRaw = readRationalArray(dv, tiffStart, entryPos, le, type, countN)
            break
        }
      }
      if (latRaw) {
        lat = rationalToDegrees(latRaw)
        if (latRef.toUpperCase() === 'S') lat = -lat
      }
      if (lonRaw) {
        lng = rationalToDegrees(lonRaw)
        if (lonRef.toUpperCase() === 'W') lng = -lng
      }
    }
  }

  // Exif IFD：DateTimeOriginal(0x9003)
  if (exifOffset !== null) {
    const exifAbs = tiffStart + exifOffset
    if (exifAbs + 2 <= dv.byteLength) {
      const exifCount = dv.getUint16(exifAbs, le)
      for (let i = 0; i < exifCount; i++) {
        const entryPos = exifAbs + 2 + i * 12
        if (entryPos + 12 > dv.byteLength) break
        const tag = dv.getUint16(entryPos, le)
        if (tag === 0x9003) {
          const type = dv.getUint16(entryPos + 2, le)
          const countN = dv.getUint32(entryPos + 4, le)
          const str = readAscii(dv, tiffStart, entryPos, le, countN)
          shotTime = parseExifDate(str)
          break
        }
      }
    }
  }

  return { lng: lng, lat: lat, shotTime: shotTime }
}

/** 读取 ASCII 值（可能内联在 value 字段，可能偏移存储） */
function readAscii(dv, tiffStart, entryPos, le, countN) {
  const total = countN * 1
  let str = ''
  if (total <= 4) {
    for (let i = 0; i < Math.min(total, 4); i++) {
      const ch = dv.getUint8(entryPos + 8 + i)
      if (ch === 0) break
      str += String.fromCharCode(ch)
    }
  } else {
    const abs = tiffStart + dv.getUint32(entryPos + 8, le)
    for (let i = 0; i < Math.min(total, 32); i++) {
      if (abs + i >= dv.byteLength) break
      const ch = dv.getUint8(abs + i)
      if (ch === 0) break
      str += String.fromCharCode(ch)
    }
  }
  return str
}

/** 读取 RATIONAL 数组（GPS 坐标为 3 个有理数） */
function readRationalArray(dv, tiffStart, entryPos, le, type, countN) {
  if (type !== 5) return null
  const total = 8 * countN
  const abs =
    total <= 4
      ? entryPos + 8
      : tiffStart + dv.getUint32(entryPos + 8, le)
  const arr = []
  for (let i = 0; i < countN; i++) {
    const pos = abs + i * 8
    if (pos + 8 > dv.byteLength) break
    const num = dv.getUint32(pos, le)
    const den = dv.getUint32(pos + 4, le)
    arr.push(den === 0 ? 0 : num / den)
  }
  return arr
}

/** 度分秒 -> 十进制 */
function rationalToDegrees(arr) {
  if (!arr || arr.length < 3) return null
  const d = arr[0]
  const m = arr[1]
  const s = arr[2]
  if (isNaN(d) || isNaN(m) || isNaN(s)) return null
  return d + m / 60 + s / 3600
}

/** 'YYYY:MM:DD HH:MM:SS' -> 时间戳（本地时区） */
function parseExifDate(str) {
  if (!str) return null
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(str)
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return isNaN(d.getTime()) ? null : d.getTime()
}

module.exports = {
  parseExif
}
