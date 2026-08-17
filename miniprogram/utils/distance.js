/**
 * 经纬度距离计算（Haversine 公式，单位：米）
 * 坐标系：高德 / 微信均为 GCJ-02，可直接互算
 */

const EARTH_RADIUS_M = 6371000

function toRad(deg) {
  return (deg * Math.PI) / 180
}

/**
 * 两点间球面距离（米）
 * @param {number} lng1
 * @param {number} lat1
 * @param {number} lng2
 * @param {number} lat2
 */
function distance(lng1, lat1, lng2, lat2) {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_M * c
}

/**
 * 将一组点按与参考点 (refLng, refLat) 的距离升序排序，并附加 distance 字段
 * @param {Array} points 含 lng/lat 字段的对象数组
 */
function sortByDistance(points, refLng, refLat) {
  return points
    .map((p) =>
      Object.assign({}, p, {
        distance: distance(p.lng, p.lat, refLng, refLat)
      })
    )
    .sort((a, b) => a.distance - b.distance)
}

module.exports = {
  distance,
  sortByDistance
}
