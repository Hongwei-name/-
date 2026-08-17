const amap = require('../../utils/amap')
const storage = require('../../utils/storage')
const util = require('../../utils/util')
const { distance } = require('../../utils/distance')

const MODES = [
  { mode: 'walking', label: '步行', icon: 'icon-walk' },
  { mode: 'bicycling', label: '骑行', icon: 'icon-bicycle' },
  { mode: 'driving', label: '驾车', icon: 'icon-car' }
]

function nearestOrder(start, islands) {
  const remaining = (islands || []).slice()
  const ordered = []
  let current = start

  while (remaining.length) {
    let nearestIndex = 0
    let nearestDistance = Infinity
    remaining.forEach((island, index) => {
      const d = distance(current.lng, current.lat, island.lng, island.lat)
      if (d < nearestDistance) {
        nearestDistance = d
        nearestIndex = index
      }
    })
    const island = remaining.splice(nearestIndex, 1)[0]
    ordered.push(Object.assign({}, island, { estimatedDistance: nearestDistance }))
    current = island
  }
  return ordered
}

Page({
  data: {
    modes: MODES,
    mode: 'driving',
    center: { lng: 116.39747, lat: 39.908823 },
    markers: [],
    polylines: [],
    stops: [],
    totalDistanceText: '',
    totalDurationText: '',
    planning: false,
    hasRoute: false,
    skippedVisitedCount: 0
  },

  onLoad() {
    this.mapCtx = null
  },

  onReady() {
    this.mapCtx = wx.createMapContext('tourMap', this)
  },

  onShow() {
    if (!this.data.hasRoute) this.planTour()
  },

  onBack() {
    wx.navigateBack()
  },

  onModeChange(e) {
    const mode = e.currentTarget.dataset.mode
    if (mode === this.data.mode || this.data.planning) return
    this.setData({ mode }, () => this.planTour())
  },

  onStartNavigation() {
    const nextStop = this.data.stops[0]
    if (!nextStop) {
      util.toast('请先计算路线')
      return
    }
    const systemInfo = wx.getSystemInfoSync()
    if (systemInfo.platform === 'devtools') {
      wx.showModal({
        title: '请在真机导航',
        content: '开发者工具无法处理地图导航协议。请使用“预览”或真机调试体验导航。',
        showCancel: false,
        confirmColor: '#0E7784'
      })
      return
    }
    wx.openLocation({
      latitude: nextStop.lat,
      longitude: nextStop.lng,
      name: nextStop.name || '第 1 站',
      address: nextStop.address || '',
      scale: 18,
      fail: () => util.toast('打开地图失败，请稍后重试')
    })
  },

  planTour() {
    if (this.data.planning) return
    const allIslands = storage.getIslands().filter((island) => isValidCoordinate(island.lng, island.lat))
    const islands = allIslands.filter((island) => !island.visited)
    const skippedVisitedCount = allIslands.length - islands.length
    if (!islands.length) {
      this.setData({ hasRoute: false, stops: [], polylines: [], markers: [], skippedVisitedCount })
      util.toast(skippedVisitedCount ? '未去过的小岛已全部完成' : '请先标记至少一座小岛')
      return
    }

    this.setData({ planning: true, hasRoute: false, stops: [], polylines: [], skippedVisitedCount })
    wx.showLoading({ title: '计算路线中', mask: true })
    getApp()
      .getLocation()
      .then((start) => {
        if (!start) throw new Error('未获取到当前位置')
        const ordered = nearestOrder(start, islands)
        return this.resolveSegments(start, ordered).then((result) => ({ start, ordered, result }))
      })
      .then(({ start, ordered, result }) => {
        wx.hideLoading()
        const markers = [
          {
            id: 0,
            latitude: start.lat,
            longitude: start.lng,
            iconPath: '/images/marker-current.png',
            width: 40,
            height: 40,
            anchor: { x: 0.5, y: 1 },
            zIndex: 10,
            label: { content: '起点', color: '#0E7784', fontSize: 11, bgColor: '#FFFFFF', borderRadius: 8, padding: 4, anchorX: -18, anchorY: -52 }
          }
        ]
        ordered.forEach((island, index) => {
          markers.push({
            id: index + 1,
            latitude: island.lat,
            longitude: island.lng,
            iconPath: '/images/marker-island.png',
            width: 34,
            height: 50,
            anchor: { x: 0.5, y: 1 },
            zIndex: 5,
            label: { content: String(index + 1), color: '#FFFFFF', fontSize: 11, bgColor: '#C95A50', borderRadius: 8, padding: 4, anchorX: -6, anchorY: -60 }
          })
        })
        const stops = ordered.map((island, index) => Object.assign({}, island, {
          order: index + 1,
          distanceText: util.formatDistance(result.segments[index].distance),
          durationText: util.formatDuration(result.segments[index].duration)
        }))
        this.setData({
          center: { lng: start.lng, lat: start.lat },
          markers,
          stops,
          totalDistanceText: util.formatDistance(result.totalDistance),
          totalDurationText: util.formatDuration(result.totalDuration),
          polylines: result.points.length ? [{ points: result.points, color: '#0E7784', width: 6, arrowLine: true }] : [],
          planning: false,
          hasRoute: true
        }, () => this.fitAllPoints(start, ordered))
      })
      .catch((err) => {
        wx.hideLoading()
        this.setData({ planning: false })
        util.toast(err.message || '路线计算失败，请检查网络')
      })
  },

  resolveSegments(start, ordered) {
    const mode = this.data.mode
    const initial = { current: start, segments: [], points: [], totalDistance: 0, totalDuration: 0 }
    return ordered.reduce((chain, island) => {
      return chain.then((state) => {
        return amap.direction(mode, state.current.lng, state.current.lat, island.lng, island.lat).then((res) => {
          const route = res.routes && res.routes[0]
          if (!route) throw new Error('未找到前往“' + island.name + '”的路线')
          state.segments.push(route)
          state.points = state.points.concat(route.points || [])
          state.totalDistance += route.distance || 0
          state.totalDuration += route.duration || 0
          state.current = island
          return state
        })
      })
    }, Promise.resolve(initial))
  },

  fitAllPoints(start, stops) {
    if (!this.mapCtx) return
    const points = [{ latitude: start.lat, longitude: start.lng }].concat(
      stops.map((stop) => ({ latitude: stop.lat, longitude: stop.lng }))
    )
    this.mapCtx.includePoints({ points, padding: [70, 36, 260, 36] })
  }
})

module.exports = { nearestOrder }

function isValidCoordinate(lng, lat) {
  if (lng === null || lng === undefined || lat === null || lat === undefined || lng === '' || lat === '') return false
  const longitude = Number(lng)
  const latitude = Number(lat)
  return Number.isFinite(longitude) && Number.isFinite(latitude) && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90
}
