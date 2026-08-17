/**
 * 相册照片读取 + EXIF 位置解析 + 自动归集匹配
 *
 * 关键点：
 *  1. 使用 wx.chooseImage 且 sizeType 取 original（原图），保留 EXIF 概率更高；
 *     wx.chooseMedia 无原图选项，压缩后 EXIF 通常被剥离。
 *  2. 通过 getFileSystemManager().readFile 读取二进制（ArrayBuffer），
 *     用 exif.js 提取 GPS 经纬度与拍摄时间。
 *  3. 有 GPS 的照片与「已标记小岛」按距离匹配（阈值见 config.MATCH_RADIUS_M），
 *     匹配失败 / 无 GPS 的照片交给用户手动归类。
 */
const config = require('../config/index')
const storage = require('./storage')
const amap = require('./amap')
const exif = require('./exif')
const { wgs84ToGcj02 } = require('./coord')
const { distance } = require('./distance')

const addressCache = {}

/**
 * 从相册选择图片（原图），返回临时路径数组
 * @param {number} count 最多张数
 * @returns Promise<string[]>
 */
function chooseImages(count) {
  const max = count || 9
  return new Promise((resolve, reject) => {
    wx.chooseImage({
      count: max,
      sizeType: ['original'], // 原图，保留 EXIF
      sourceType: ['album'],
      success: (res) => resolve(res.tempFilePaths || []),
      fail: (err) => {
        if (err && /cancel/i.test(err.errMsg || '')) {
          resolve([])
        } else {
          reject(err)
        }
      }
    })
  })
}

/** 读取文件为 ArrayBuffer */
function readFileAsArrayBuffer(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: filePath,
      encoding: '',
      success: (res) => resolve(res.data),
      fail: reject
    })
  })
}

/**
 * 将临时文件持久化到小程序本地用户目录
 * （chooseImage 返回的临时路径在小程序重启后失效，必须落盘为持久路径）
 * @param {string} tempPath
 * @returns Promise<string> 持久路径
 */
function persistImage(tempPath) {
  return new Promise((resolve) => {
    const fs = wx.getFileSystemManager()
    const m = /\.(\w+)$/.exec(tempPath || '')
    const ext = m ? m[1].toLowerCase() : 'jpg'
    const dest =
      wx.env.USER_DATA_PATH +
      '/' +
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2, 8) +
      '.' +
      ext
    fs.saveFile({
      tempFilePath: tempPath,
      filePath: dest,
      success: () => resolve(dest),
      fail: (err) => {
        console.warn('[photo] 持久化失败，将使用临时路径', err)
        resolve(tempPath)
      }
    })
  })
}

/**
 * 提取单张照片的 EXIF 元数据
 * 注意：EXIF 中的 GPS 经纬度为 WGS-84，返回前统一转换为 GCJ-02
 * （与微信 map 组件 / 高德 API 坐标系一致），避免匹配与展示永久偏移。
 * @param {string} filePath
 * @returns Promise<{path, lng, lat, shotTime, hasGps}>
 */
function extractMeta(filePath) {
  return readFileAsArrayBuffer(filePath)
    .then((buf) => {
      const info = exif.parseExif(buf)
      let lng = info.lng
      let lat = info.lat
      if (lng !== null && lat !== null) {
        const gcj = wgs84ToGcj02(lng, lat)
        lng = gcj.lng
        lat = gcj.lat
      }
      return {
        path: filePath,
        lng: lng,
        lat: lat,
        shotTime: info.shotTime,
        hasGps: lng !== null && lat !== null
      }
    })
    .catch((err) => {
      console.warn('[photo] 读取/解析失败', filePath, err)
      return { path: filePath, lng: null, lat: null, shotTime: null, hasGps: false }
    })
}

/** 将照片 GPS 坐标转为可读地址；相同坐标复用请求结果。 */
function resolveAddress(lng, lat) {
  if (!isValidCoordinate(lng, lat)) return Promise.resolve('')
  const key = Number(lng).toFixed(5) + ',' + Number(lat).toFixed(5)
  if (!addressCache[key]) {
    addressCache[key] = amap
      .regeo(lng, lat)
      .then((info) => info.formatted_address || '')
      .catch((err) => {
        console.warn('[photo] 拍摄地址解析失败', err)
        return ''
      })
  }
  return addressCache[key]
}

/**
 * 将照片 GPS 匹配到最近的已标记小岛（距离小于阈值）
 * @param {object} photoMeta {lng, lat}
 * @param {Array} islands
 * @returns {{island: object, distM: number}|null}
 */
function matchIsland(photoMeta, islands) {
  if (!photoMeta || !isValidCoordinate(photoMeta.lng, photoMeta.lat)) return null
  const radius = config.MATCH_RADIUS_M
  let best = null
  ;(islands || []).forEach((isl) => {
    if (!isValidCoordinate(isl.lng, isl.lat)) return
    const d = distance(photoMeta.lng, photoMeta.lat, isl.lng, isl.lat)
    if (d <= radius && (!best || d < best.distM)) {
      best = { island: isl, distM: d }
    }
  })
  return best
}

/**
 * 批量分析：选择照片 -> 逐张提取 EXIF -> 自动匹配小岛
 * @param {number} count 选择张数
 * @returns Promise<Array<{path, lng, lat, shotTime, hasGps, matchedIsland|null, distM|null}>>
 */
function importPhotosWithMatch(count) {
  return chooseImages(count).then((paths) => {
    if (!paths.length) return []
    // 串行读取，控制内存
    const chain = paths.reduce(
      (p, filePath) =>
        p.then((acc) =>
          extractMeta(filePath).then((meta) =>
            // 先持久化，避免临时路径失效
            persistImage(filePath).then((persisted) =>
              resolveAddress(meta.lng, meta.lat).then((locationName) => {
                const matched = matchIsland(meta, storage.getIslands())
                acc.push(
                  Object.assign({}, meta, {
                    path: persisted,
                    locationName,
                    matchedIsland: matched ? matched.island : null,
                    distM: matched ? matched.distM : null
                  })
                )
                return acc
              })
            )
          )
        ),
      Promise.resolve([])
    )
    return chain
  })
}

/**
 * 从相册选择照片，直接归集到指定小岛（不依赖 EXIF 定位）
 * @param {string} islandId
 * @returns Promise<Array<{path, lng, lat, shotTime, hasGps}>>
 */
function importPhotosToIsland(islandId) {
  return chooseImages(9).then((paths) => {
    if (!paths.length) return []
    const chain = paths.reduce(
      (p, filePath) =>
        p.then((acc) =>
          extractMeta(filePath).then((meta) =>
            persistImage(filePath).then((persisted) =>
              resolveAddress(meta.lng, meta.lat).then((locationName) => {
                storage.addPhoto(
                  Object.assign({}, meta, {
                    islandId: islandId,
                    exifLng: meta.lng,
                    exifLat: meta.lat,
                    locationName,
                    localPath: persisted
                  })
                )
                acc.push(Object.assign({}, meta, { path: persisted, locationName }))
                return acc
              })
            )
          )
        ),
      Promise.resolve([])
    )
    return chain
  })
}

/** 保存一批归集结果（photo-import 页确认时调用） */
function commitPhotos(results) {
  ;(results || []).forEach((r) => {
    if (!r.islandId) return
    storage.addPhoto({
      islandId: r.islandId,
      localPath: r.path,
      exifLng: r.lng,
      exifLat: r.lat,
      shotTime: r.shotTime,
      locationName: r.locationName || ''
    })
  })
}

function isValidCoordinate(lng, lat) {
  if (lng === null || lng === undefined || lat === null || lat === undefined || lng === '' || lat === '') return false
  const longitude = Number(lng)
  const latitude = Number(lat)
  return Number.isFinite(longitude) && Number.isFinite(latitude) && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90
}

module.exports = {
  chooseImages,
  extractMeta,
  resolveAddress,
  matchIsland,
  importPhotosWithMatch,
  importPhotosToIsland,
  commitPhotos
}
