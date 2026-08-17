/**
 * 行屿 - 核心逻辑单元测试（node 环境运行，不依赖 wx）
 * 覆盖：EXIF GPS 解析、距离计算
 * 运行：node tools/test-core.js
 */
const assert = require('assert')
const { parseExif } = require('../miniprogram/utils/exif.js')
const { distance } = require('../miniprogram/utils/distance.js')
const { wgs84ToGcj02, gcj02ToWgs84 } = require('../miniprogram/utils/coord.js')

/* ---------------- 构造测试 JPEG（带 EXIF GPS） ---------------- */

function u16(v) {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(v, 0)
  return b
}
function u32(v) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(v, 0)
  return b
}

/** 构造一个最小 JPEG：SOI + APP1(Exif: 经纬度 30°16'32.5"N, 120°7'18.75"E + 拍摄时间) + EOI */
function buildTestJpeg() {
  const parts = []
  parts.push(Buffer.from([0xff, 0xd8])) // SOI

  // TIFF 数据（little-endian）
  const tiff = []
  tiff.push(Buffer.from([0x49, 0x49])) // II
  tiff.push(u16(42))
  tiff.push(u32(8)) // IFD0 offset = 8

  const ifd0Start = 8
  // IFD0: 2 entries
  const ifd0Count = 2
  const ifd0Size = 2 + ifd0Count * 12 + 4
  const exifIfdOffset = ifd0Start + ifd0Size // Exif IFD 紧随其后
  const gpsIfdOffset = exifIfdOffset + 2 + 12 + 4 // GPS IFD 紧随 Exif IFD

  // IFD0 header
  tiff.push(u16(ifd0Count))
  // entry0: tag 0x8769 (Exif IFD), type 4, count 1, value = exifIfdOffset
  tiff.push(u16(0x8769))
  tiff.push(u16(4))
  tiff.push(u32(1))
  tiff.push(u32(exifIfdOffset))
  // entry1: tag 0x8825 (GPS IFD), type 4, count 1, value = gpsIfdOffset
  tiff.push(u16(0x8825))
  tiff.push(u16(4))
  tiff.push(u32(1))
  tiff.push(u32(gpsIfdOffset))
  tiff.push(u32(0)) // next IFD = 0

  // Exif IFD: 1 entry (DateTimeOriginal 0x9003)
  const dateStr = '2023:10:01 12:30:45\0' // 20 bytes
  const dateOffset = gpsIfdOffset + 2 + 4 * 12 + 4 // 日期字符串放在 GPS IFD 之后
  tiff.push(u16(1))
  tiff.push(u16(0x9003))
  tiff.push(u16(2)) // ASCII
  tiff.push(u32(dateStr.length))
  tiff.push(u32(dateOffset))
  tiff.push(u32(0)) // next IFD

  // GPS IFD: 4 entries
  const gpsCount = 4
  const latRationalOffset = dateOffset + dateStr.length // 纬度有理数区
  const lonRationalOffset = latRationalOffset + 3 * 8 // 经度有理数区
  tiff.push(u16(gpsCount))
  // entry0: 0x0001 GPSLatitudeRef, ASCII, count 2, inline "N\0"（value 字段固定 4 字节）
  tiff.push(u16(0x0001))
  tiff.push(u16(2))
  tiff.push(u32(2))
  tiff.push(Buffer.from([0x4e, 0x00, 0x00, 0x00])) // "N\0\0\0"
  // entry1: 0x0002 GPSLatitude, RATIONAL, count 3, offset
  tiff.push(u16(0x0002))
  tiff.push(u16(5))
  tiff.push(u32(3))
  tiff.push(u32(latRationalOffset))
  // entry2: 0x0003 GPSLongitudeRef, ASCII, count 2, inline "E\0"（value 字段固定 4 字节）
  tiff.push(u16(0x0003))
  tiff.push(u16(2))
  tiff.push(u32(2))
  tiff.push(Buffer.from([0x45, 0x00, 0x00, 0x00])) // "E\0\0\0"
  // entry3: 0x0004 GPSLongitude, RATIONAL, count 3, offset
  tiff.push(u16(0x0004))
  tiff.push(u16(5))
  tiff.push(u32(3))
  tiff.push(u32(lonRationalOffset))
  tiff.push(u32(0)) // next IFD

  // 日期字符串
  tiff.push(Buffer.from(dateStr, 'ascii'))

  // 纬度有理数：30° 16' 32.5"
  tiff.push(u32(30)); tiff.push(u32(1))
  tiff.push(u32(16)); tiff.push(u32(1))
  tiff.push(u32(325)); tiff.push(u32(10))
  // 经度有理数：120° 7' 18.75"
  tiff.push(u32(120)); tiff.push(u32(1))
  tiff.push(u32(7)); tiff.push(u32(1))
  tiff.push(u32(1875)); tiff.push(u32(100))

  const tiffBuf = Buffer.concat(tiff)

  // APP1 段
  const app1Payload = Buffer.concat([
    Buffer.from('Exif\x00\x00', 'ascii'),
    tiffBuf
  ])
  parts.push(Buffer.from([0xff, 0xe1]))
  parts.push(u16(app1Payload.length + 2))
  parts.push(app1Payload)

  parts.push(Buffer.from([0xff, 0xd9])) // EOI
  return Buffer.concat(parts)
}

/* ---------------- 测试 ---------------- */

function testExif() {
  const buf = buildTestJpeg()
  const info = parseExif(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))

  assert(info, '应能解析出 EXIF')
  assert(info.lat !== null, '应解析出纬度')
  assert(info.lng !== null, '应解析出经度')

  // 30°16'32.5" = 30 + 16/60 + 32.5/3600
  const expectLat = 30 + 16 / 60 + 32.5 / 3600
  // 120°7'18.75" = 120 + 7/60 + 18.75/3600
  const expectLng = 120 + 7 / 60 + 18.75 / 3600

  assert(Math.abs(info.lat - expectLat) < 1e-9, '纬度精度错误: ' + info.lat + ' vs ' + expectLat)
  assert(Math.abs(info.lng - expectLng) < 1e-9, '经度精度错误: ' + info.lng + ' vs ' + expectLng)

  // 拍摄时间（本地时区解析 2023-10-01 12:30:45）
  const d = new Date(2023, 9, 1, 12, 30, 45)
  assert(info.shotTime === d.getTime(), '拍摄时间错误: ' + info.shotTime + ' vs ' + d.getTime())

  console.log('✓ EXIF: 纬度=' + info.lat.toFixed(7) + ', 经度=' + info.lng.toFixed(7) + ', 时间=' + new Date(info.shotTime).toString())
}

function testNoExif() {
  // 纯 JPEG 无 APP1
  const buf = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xd9])])
  const info = parseExif(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  assert(info.lng === null && info.lat === null, '无 EXIF 时经纬度应为 null')
  console.log('✓ 无 EXIF 图片正确返回 null')
}

function testDistance() {
  // 北京天安门 -> 上海人民广场，约 1067km
  const d = distance(116.397428, 39.90923, 121.473701, 31.230416)
  assert(d > 1050000 && d < 1090000, '距离超出预期: ' + d)
  console.log('✓ 距离: 天安门->人民广场 ' + (d / 1000).toFixed(1) + 'km')

  // 相同点距离 0
  assert(distance(116.397428, 39.90923, 116.397428, 39.90923) === 0, '同点距离应为 0')
  console.log('✓ 同点距离为 0')
}

function testCoord() {
  // 北京天安门：WGS-84 -> GCJ-02（参考：天安门城楼 GCJ-02 ≈ 116.3975, 39.9088，误差应 < 0.0005° ≈ 55m）
  const t = wgs84ToGcj02(116.391275, 39.907445)
  assert(Math.abs(t.lng - 116.3975) < 0.0005, '转换经度偏差过大: ' + t.lng)
  assert(Math.abs(t.lat - 39.9088) < 0.0005, '转换纬度偏差过大: ' + t.lat)
  console.log('✓ WGS84->GCJ02 天安门: (' + t.lng.toFixed(6) + ', ' + t.lat.toFixed(6) + ')')

  // Roundtrip 自洽：正向再反向应回到原点（反向为近似算法，容差 5e-5° ≈ 5m）
  const g = wgs84ToGcj02(121.46915, 31.22461)
  const back = gcj02ToWgs84(g.lng, g.lat)
  assert(Math.abs(back.lng - 121.46915) < 5e-5, 'roundtrip 经度误差过大: ' + back.lng)
  assert(Math.abs(back.lat - 31.22461) < 5e-5, 'roundtrip 纬度误差过大: ' + back.lat)
  console.log('✓ GCJ02<->WGS84 roundtrip 自洽')

  // 中国境外不转换（纽约）
  const ny = wgs84ToGcj02(-74.006, 40.7128)
  assert(ny.lng === -74.006 && ny.lat === 40.7128, '境外坐标不应转换')
  console.log('✓ 境外坐标原样返回')
}

testExif()
testNoExif()
testDistance()
testCoord()
console.log('\n全部核心逻辑测试通过 ✅')
