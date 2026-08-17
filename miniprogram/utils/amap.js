/**
 * 高德开放平台 REST API 封装
 *
 * 全部地理能力（搜索 / 逆地理 / 路线规划）均调用高德 Web 服务接口，
 * 使用自有 ApiKey（见 config/index.js 的 AMAP_KEY）。
 *
 * 注意：小程序正式上线需在「微信公众平台 - 开发管理 - 服务器域名」中
 * 添加 request 合法域名：https://restapi.amap.com
 * （开发阶段可在开发者工具中勾选「不校验合法域名」）
 */
const config = require('../config/index')

const AMAP_KEY = config.AMAP_KEY
const BASE = 'https://restapi.amap.com/v3'
const V4_BASE = 'https://restapi.amap.com/v4'

/** 高德错误码 -> 可操作的中文提示 */
const AMAP_ERROR_HINTS = {
  INVALID_USER_KEY: '高德 Key 无效：请检查 config/index.js 中的 AMAP_KEY 是否正确填写',
  USERKEY_PLAT_NOMATCH:
    '高德 Key 平台不匹配：请在 console.amap.com 中给该 Key 勾选「Web服务」平台（创建/修改 Key 时服务平台选择「Web服务」）',
  USER_DAILY_QUERY_OVER_LIMIT: '高德每日配额已用完，请明日再试或升级配额',
  DAILY_QUERY_OVER_LIMIT: '高德 QPS 超限：请求过于频繁，请稍后再试',
  INSUFFICIENT_PRIVILEGES: '高德权限不足：请检查 Key 的服务类型与接口权限',
  INVALID_PARAMS: '请求参数错误',
  NO_PERMISSION: '无访问权限（Key 未启用或未实名认证）',
  UNKNOWN_ERROR: '高德服务异常，请稍后再试'
}

/** 统一请求封装 */
function request(path, params) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE + path,
      data: Object.assign({ key: AMAP_KEY }, params),
      method: 'GET',
      timeout: 10000,
      success: (res) => {
        const data = res.data || {}
        if (data.status === '1') {
          resolve(data)
        } else {
          const info = data.info || '高德接口返回异常'
          const hint = AMAP_ERROR_HINTS[data.infocode] || AMAP_ERROR_HINTS[info]
          reject(new Error(hint ? hint + '（' + info + '）' : info))
        }
      },
      fail: (err) => {
        reject(new Error((err && err.errMsg) || '网络请求失败'))
      }
    })
  })
}

/** 高德 V4 接口使用 errcode / errmsg / data，与 V3 响应格式不同。 */
function requestV4(path, params) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: V4_BASE + path,
      data: Object.assign({ key: AMAP_KEY }, params),
      method: 'GET',
      timeout: 10000,
      success: (res) => {
        const data = res.data || {}
        if (Number(data.errcode) === 0) {
          resolve(data.data || {})
        } else {
          reject(new Error(data.errmsg || '高德骑行路线服务异常'))
        }
      },
      fail: (err) => {
        reject(new Error((err && err.errMsg) || '网络请求失败'))
      }
    })
  })
}

/**
 * 关键词搜索地点 / 景点 / 地名 / 地标
 * @param {string} keywords 关键词
 * @param {object} opts { city, offset, page }
 * @returns Promise<Array<{id,name,address,lng,lat,city,district,type}>>
 */
function searchPlaces(keywords, opts) {
  const o = opts || {}
  return request('/place/text', {
    keywords: keywords,
    city: o.city !== undefined ? o.city : config.SEARCH_CITY,
    citylimit: o.citylimit || false,
    offset: o.offset || 20,
    page: o.page || 1,
    extensions: 'base'
  }).then((data) => {
    const pois = data.pois || []
    return pois.map((p) => ({
      id: p.id,
      name: p.name || '',
      address: p.address || (p.pname || '') + (p.cityname || '') + (p.adname || ''),
      lng: parseFloat((p.location || '').split(',')[0]),
      lat: parseFloat((p.location || '').split(',')[1]),
      city: p.cityname || '',
      district: p.adname || '',
      type: p.type || ''
    }))
  })
}

/**
 * 逆地理编码：经纬度 -> 地址 / 位置名 / 周边 POI
 * @param {number} lng
 * @param {number} lat
 * @returns Promise<{formatted_address, addressComponent, pois}>
 */
function regeo(lng, lat) {
  return request('/geocode/regeo', {
    location: lng + ',' + lat,
    extensions: 'all',
    radius: 1000
  }).then((data) => {
    const rg = (data.regeocode || {})
    const addressComponent = rg.addressComponent || {}
    const pois = (rg.pois || []).map((p) => ({
      id: p.id,
      name: p.name || '',
      address: p.address || '',
      lng: parseFloat((p.location || '').split(',')[0]),
      lat: parseFloat((p.location || '').split(',')[1]),
      distance: parseFloat(p.distance) || 0
    }))
    return {
      formatted_address: rg.formatted_address || '',
      province: addressComponent.province || '',
      city: addressComponent.city || addressComponent.province || '',
      district: addressComponent.district || '',
      pois: pois
    }
  })
}

/**
 * 解析高德 polyline 字符串 -> 地图折线坐标数组
 * 'lng,lat;lng,lat;...' -> [{longitude, latitude}]
 */
function parsePolyline(str) {
  if (!str) return []
  return str
    .split(';')
    .map((pair) => {
      const parts = pair.split(',')
      const lng = parseFloat(parts[0])
      const lat = parseFloat(parts[1])
      if (isNaN(lng) || isNaN(lat)) return null
      return { longitude: lng, latitude: lat }
    })
    .filter(Boolean)
}

/**
 * 路线规划（统一入口）
 * @param {string} mode walking | bicycling | driving | transit
 * @param {number} originLng
 * @param {number} originLat
 * @param {number} destLng
 * @param {number} destLat
 * @param {object} opts { city } 公交方式必传城市（建议取起点所在城市）
 * @returns Promise<{routes: Array<{distance, duration, strategy, steps, points}>}>
 */
function direction(mode, originLng, originLat, destLng, destLat, opts) {
  const o = opts || {}
  const origin = originLng + ',' + originLat
  const destination = destLng + ',' + destLat
  let path = ''
  let params = { origin, destination }

  // 骑行规划为高德 V4 服务，响应结构为 { errcode, errmsg, data }。
  if (mode === 'bicycling') {
    return requestV4('/direction/bicycling', params).then((route) => normalizePathRoute(mode, route))
  }

  switch (mode) {
    case 'walking':
      path = '/direction/walking'
      break
    case 'driving':
      path = '/direction/driving'
      params.strategy = 0 // 速度优先
      break
    case 'transit':
      path = '/direction/transit/integrated'
      params.city = o.city || config.SEARCH_CITY || '北京' // 公交必须传 city
      break
    default:
      return Promise.reject(new Error('不支持的出行方式'))
  }

  return request(path, params).then((data) => {
    const route = data.route || {}
    if (mode === 'transit') {
      return normalizeTransit(route)
    }
    return normalizePathRoute(mode, route)
  })
}

/** 归一化 walking / bicycling / driving 的 paths */
function normalizePathRoute(mode, route) {
  const paths = route.paths || []
  return {
    routes: paths.map((p) => ({
      mode: mode,
      distance: parseFloat(p.distance) || 0,
      duration: parseFloat(p.duration) || 0,
      strategy: p.strategy || '',
      steps: (p.steps || []).map((s) => ({
        instruction: s.instruction || '',
        road: s.road || '',
        distance: parseFloat(s.distance) || 0
      })),
      points: (p.steps || []).reduce((acc, s) => acc.concat(parsePolyline(s.polyline)), [])
    }))
  }
}

/** 归一化公交方案 transits（文字指引含步行段 + 公交段） */
function normalizeTransit(route) {
  const transits = route.transits || []
  return {
    routes: transits.map((t) => {
      const steps = []
      const points = []
      ;(t.segments || []).forEach((seg) => {
        const walk = seg.walking || {}
        ;(walk.steps || []).forEach((s) => {
          steps.push({ instruction: s.instruction || '' })
          points.push.apply(points, parsePolyline(s.polyline))
        })
        const bus = seg.bus || {}
        ;(bus.buslines || []).forEach((line) => {
          const dep = (line.departure_stop && line.departure_stop.name) || ''
          const arr = (line.arrival_stop && line.arrival_stop.name) || ''
          steps.push({
            instruction: '乘坐' + (line.name || '公交') + (dep ? '（' + dep + '上车' : '') + (arr ? '，' + arr + '下车' : '') + '）'
          })
          if (line.polyline) points.push.apply(points, parsePolyline(line.polyline))
        })
      })
      return {
        mode: 'transit',
        distance: parseFloat(t.distance) || 0,
        duration: parseFloat(t.duration) || 0,
        strategy: '公交',
        steps: steps,
        points: points
      }
    })
  }
}

/**
 * 周边搜索：以指定坐标为中心，按 POI 分类查找附近地点（如景点 110000 / 餐饮 050000）
 * @param {number} lng
 * @param {number} lat
 * @param {object} opts { types, keywords, radius, offset, page, sortrule }
 * @returns Promise<Array<{id,name,address,lng,lat,city,district,type,rating,cost}>>
 */
function searchAround(lng, lat, opts) {
  const o = opts || {}
  return request('/place/around', {
    location: lng + ',' + lat,
    types: o.types || '',
    keywords: o.keywords || '',
    radius: o.radius || 5000,
    offset: o.offset || 20,
    page: o.page || 1,
    sortrule: o.sortrule || 'distance',
    extensions: 'all'
  }).then((data) => {
    const pois = data.pois || []
    return pois.map((p) => {
      const biz = p.biz_ext || {}
      const rating = parseFloat(biz.rating)
      const cost = parseFloat(biz.cost)
      return {
        id: p.id,
        name: p.name || '',
        address: p.address || (p.pname || '') + (p.cityname || '') + (p.adname || ''),
        lng: parseFloat((p.location || '').split(',')[0]),
        lat: parseFloat((p.location || '').split(',')[1]),
        city: p.cityname || '',
        district: p.adname || '',
        type: p.type || '',
        rating: isNaN(rating) ? null : rating,
        cost: isNaN(cost) ? null : cost
      }
    })
  })
}

module.exports = {
  searchPlaces,
  searchAround,
  regeo,
  direction,
  parsePolyline
}
