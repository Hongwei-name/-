/**
 * 路线规划页
 *  - 起点：用户当前位置（自动定位）
 *  - 终点：已标记小岛 / 高德搜索地点 / 由首页或详情页带入
 *  - 出行方式：步行 / 骑行 / 驾车 / 公交（高德路线规划 API）
 *  - 展示距离、耗时、路线文字指引，地图渲染轨迹，支持切换不同方案
 */
const amap = require('../../utils/amap')
const storage = require('../../utils/storage')
const util = require('../../utils/util')

const MODES = [
  { mode: 'walking', label: '步行', icon: 'icon-walk' },
  { mode: 'bicycling', label: '骑行', icon: 'icon-bicycle' },
  { mode: 'driving', label: '驾车', icon: 'icon-car' },
  { mode: 'transit', label: '公交', icon: 'icon-transit' }
]

Page({
  data: {
    modes: MODES,
    mode: 'walking',
    start: null,   // {lng, lat, name}
    end: null,     // {lng, lat, name, address}
    center: { lng: 116.39747, lat: 39.908823 },
    markers: [],
    polylines: [],
    route: null,   // {distanceText, durationText, points}
    steps: [],
    schemeIndex: 0,
    schemeCount: 0,
    planning: false,
    islands: [],
    searchOpen: false,
    keyword: '',
    endResults: []
  },

  onLoad(options) {
    this.setData({ islands: storage.getIslands() })

    // 终点来源：小岛 id / 全局待选终点
    if (options.endId) {
      const island = storage.getIsland(options.endId)
      if (island) {
        this.setData({
          end: { lng: island.lng, lat: island.lat, name: island.name, address: island.address }
        })
      }
    }
    const app = getApp()
    if (app.globalData.pendingRouteEnd) {
      const pt = app.globalData.pendingRouteEnd
      app.globalData.pendingRouteEnd = null
      this.setData({ end: { lng: pt.lng, lat: pt.lat, name: pt.name, address: pt.address } })
    }

    // 获取起点位置
    app.getLocation().then((loc) => {
      if (loc) {
        this.setData({
          start: { lng: loc.lng, lat: loc.lat, name: loc.name },
          center: { lng: loc.lng, lat: loc.lat }
        })
        this.buildMarkers()
        this.plan()
      } else {
        util.toast('未获取到定位，无法规划路线，请检查定位权限')
      }
    })
  },

  /* ---------- 规划 ---------- */

  plan() {
    const start = this.data.start
    const end = this.data.end
    if (!start || !end) return
    const mode = this.data.mode
    const requestId = (this.planRequestId || 0) + 1
    this.planRequestId = requestId
    this.setData({ planning: true })
    wx.showLoading({ title: '规划中', mask: true })

    const run = (city) => {
      amap
        .direction(mode, start.lng, start.lat, end.lng, end.lat, { city })
        .then((res) => {
          if (requestId !== this.planRequestId) return
          wx.hideLoading()
          this.setData({ planning: false })
          if (!res.routes || !res.routes.length) {
            util.toast('未找到可行路线')
            this.setData({ route: null, steps: [], schemeCount: 0, polylines: [] })
            return
          }
          this.setData({ schemeCount: res.routes.length, schemeIndex: 0 })
          this.applyRoute(res.routes[0])
        })
        .catch((err) => {
          if (requestId !== this.planRequestId) return
          wx.hideLoading()
          this.setData({ planning: false })
          util.toast(err.message || '路线规划失败，请检查网络')
        })
    }

    // 公交需要城市参数，先反查起点城市
    if (mode === 'transit') {
      amap
        .regeo(start.lng, start.lat)
        .then((info) => run(info.city))
        .catch(() => run(''))
    } else {
      run('')
    }
  },

  applyRoute(r) {
    this.setData({
      route: {
        distanceText: util.formatDistance(r.distance),
        durationText: util.formatDuration(r.duration),
        strategy: r.strategy
      },
      steps: r.steps || [],
      polylines:
        r.points && r.points.length
          ? [{ points: r.points, color: '#2B5CD9', width: 6, arrowLine: true }]
          : []
    })
    this.buildMarkers()
  },

  onModeChange(e) {
    const mode = e.currentTarget.dataset.mode
    if (mode === this.data.mode) return
    this.setData({ mode }, () => this.plan())
  },

  onBack() {
    wx.navigateBack()
  },

  /** 打开微信内置地图，由其提供实时导航与路线选择。 */
  onStartNavigation() {
    const end = this.data.end
    if (!end) {
      util.toast('请先选择终点')
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
      latitude: end.lat,
      longitude: end.lng,
      name: end.name || '目的地',
      address: end.address || '',
      scale: 18,
      fail: () => util.toast('打开地图失败，请稍后重试')
    })
  },

  /** 切换路线方案 */
  onSchemeTap() {
    const total = this.data.schemeCount
    if (total < 2) return
    const next = (this.data.schemeIndex + 1) % total
    const requestId = (this.planRequestId || 0) + 1
    this.planRequestId = requestId
    const start = this.data.start
    const end = this.data.end
    const run = (city) => {
      amap
        .direction(this.data.mode, start.lng, start.lat, end.lng, end.lat, { city })
        .then((res) => {
          if (requestId !== this.planRequestId) return
          const routes = res.routes || []
          if (routes[next]) {
            this.setData({ schemeIndex: next })
            this.applyRoute(routes[next])
          }
        })
        .catch(() => {
          if (requestId === this.planRequestId) util.toast('切换路线方案失败，请稍后重试')
        })
    }
    if (this.data.mode === 'transit') {
      amap.regeo(start.lng, start.lat).then((info) => run(info.city)).catch(() => run(''))
    } else {
      run('')
    }
  },

  buildMarkers() {
    const markers = []
    if (this.data.start) {
      markers.push({
        id: 1,
        latitude: this.data.start.lat,
        longitude: this.data.start.lng,
        iconPath: '/images/marker-current.png',
        width: 40,
        height: 40,
        anchor: { x: 0.5, y: 1 },
        label: { content: '起点', color: '#2FA96B', fontSize: 11, bgColor: '#FFFFFF', borderRadius: 8, padding: 4, anchorX: -15, anchorY: -56 }
      })
    }
    if (this.data.end) {
      markers.push({
        id: 2,
        latitude: this.data.end.lat,
        longitude: this.data.end.lng,
        iconPath: '/images/marker-point.png',
        width: 34,
        height: 50,
        anchor: { x: 0.5, y: 1 },
        label: { content: '终点', color: '#E8564C', fontSize: 11, bgColor: '#FFFFFF', borderRadius: 8, padding: 4, anchorX: -15, anchorY: -60 }
      })
    }
    this.setData({ markers })
  },

  /* ---------- 终点搜索 ---------- */

  onToggleSearch() {
    this.setData({ searchOpen: !this.data.searchOpen })
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value })
  },

  onSearchEnd() {
    const kw = (this.data.keyword || '').trim()
    if (!kw) return
    const requestId = (this.endSearchRequestId || 0) + 1
    this.endSearchRequestId = requestId
    amap
      .searchPlaces(kw)
      .then((list) => {
        if (requestId === this.endSearchRequestId) this.setData({ endResults: list })
      })
      .catch((err) => {
        if (requestId === this.endSearchRequestId) util.toast(err.message || '搜索失败')
      })
  },

  onEndResultTap(e) {
    const item = this.data.endResults[e.currentTarget.dataset.index]
    if (!item) return
    this.setEnd({ lng: item.lng, lat: item.lat, name: item.name, address: item.address })
  },

  onIslandTap(e) {
    const island = storage.getIsland(e.currentTarget.dataset.id)
    if (!island) return
    this.setEnd({ lng: island.lng, lat: island.lat, name: island.name, address: island.address })
  },

  setEnd(end) {
    if (!isValidCoordinate(end.lng, end.lat)) {
      util.toast('终点坐标无效')
      return
    }
    this.endSearchRequestId = (this.endSearchRequestId || 0) + 1
    this.setData({
      end,
      searchOpen: false,
      keyword: '',
      endResults: [],
      schemeCount: 0,
      route: null,
      steps: [],
      polylines: []
    }, () => {
      this.buildMarkers()
      this.plan()
    })
  }
})

function isValidCoordinate(lng, lat) {
  if (lng === null || lng === undefined || lat === null || lat === undefined || lng === '' || lat === '') return false
  const longitude = Number(lng)
  const latitude = Number(lat)
  return Number.isFinite(longitude) && Number.isFinite(latitude) && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90
}
