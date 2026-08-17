/**
 * 坐标系转换工具
 *
 * 背景：
 *  - 微信 map 组件 / wx.getLocation({type:'gcj02'}) / 高德开放平台 API 统一使用 GCJ-02（火星坐标），互通无偏移
 *  - 照片 EXIF 中的拍摄经纬度、GPS 设备原始输出为 WGS-84（国际 GPS 坐标），中国境内与 GCJ-02 存在 100~600 米偏差
 *  - 百度为 BD-09（本项目不使用）
 *
 * 因此：所有来自 EXIF / GPS 原始设备的坐标，在使用前必须经 wgs84ToGcj02 转换。
 */

const PI = Math.PI
const A = 6378245.0
const EE = 0.00669342162296594323

/** 中国境外直接返回原值（转换公式仅适用于中国境内） */
function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0
  return ret
}

/**
 * WGS-84 -> GCJ-02（火星坐标）
 * @param {number} lng
 * @param {number} lat
 * @returns {{lng: number, lat: number}}
 */
function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) {
    return { lng: lng, lat: lat }
  }
  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI)
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI)
  return { lng: lng + dLng, lat: lat + dLat }
}

/**
 * GCJ-02 -> WGS-84（反向近似，误差约 0.5 米）
 * @param {number} lng
 * @param {number} lat
 * @returns {{lng: number, lat: number}}
 */
function gcj02ToWgs84(lng, lat) {
  if (outOfChina(lng, lat)) {
    return { lng: lng, lat: lat }
  }
  const g = wgs84ToGcj02(lng, lat)
  return {
    lng: lng * 2 - g.lng,
    lat: lat * 2 - g.lat
  }
}

module.exports = {
  wgs84ToGcj02,
  gcj02ToWgs84
}
