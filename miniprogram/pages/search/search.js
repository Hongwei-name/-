/**
 * 地图搜索页
 *  - 默认态：自动加载「附近景点推荐」（高德周边搜索，风景名胜分类，按距离排序）
 *  - 搜索态：保留关键词搜索（历史 / 结果定位 / 标记小岛 / 路线规划）
 *  - 列表项操作：点击回到地图定位；标记为小岛；设为路线终点
 */
const amap = require('../../utils/amap')
const storage = require('../../utils/storage')
const util = require('../../utils/util')
const { distance } = require('../../utils/distance')

const NEARBY_RADIUS_M = 6000 // 附近搜索半径（米）
const NEARBY_TYPES = '110000' // 高德 POI 分类：风景名胜
const SEARCH_RADIUS_M = 50000 // 关键词搜索优先覆盖当前位置 50 公里内
const SEARCH_DEBOUNCE_MS = 350

Page({
  data: {
    keyword: '',
    history: [],
    results: [],
    searching: false,
    searched: false,
    // 附近景点
    nearby: [],
    nearbyLoading: false,
    nearbyLoaded: false,
    hasLocation: false
  },

  onShow() {
    this.setData({ history: storage.getHistory() })
    // 非搜索态时确保附近景点已加载
    if (!this.data.searched) {
      this.loadNearby()
    }
  },

  onPullDownRefresh() {
    if (this.data.searched) {
      this.onSearch()
    } else {
      this.loadNearby()
    }
    wx.stopPullDownRefresh()
  },

  /* ---------- 附近景点推荐 ---------- */

  loadNearby() {
    if (this.data.nearbyLoading) return
    const app = getApp()

    // 优先用缓存定位，没有则实时获取
    const ensureLoc = app.globalData.location
      ? Promise.resolve(app.globalData.location)
      : app.ensureLocation()

    this.setData({ nearbyLoading: true })

    ensureLoc
      .then((loc) => {
        if (!loc) {
          this.setData({ nearbyLoading: false, nearbyLoaded: true, hasLocation: false })
          return
        }
        this.setData({ hasLocation: true })
        return amap
          .searchAround(loc.lng, loc.lat, {
            types: NEARBY_TYPES,
            radius: NEARBY_RADIUS_M,
            offset: 20,
            sortrule: 'distance'
          })
          .then((list) => {
            const nearby = list.filter((p) => p.rating === null || p.rating >= 3).map((p) => {
              const d = distance(p.lng, p.lat, loc.lng, loc.lat)
              const ratingText = p.rating ? '评分 ' + p.rating.toFixed(1) : ''
              return Object.assign({}, p, {
                distanceText: util.formatDistance(d),
                ratingText
              })
            })
            nearby.sort((a, b) => {
              const aDistance = distance(a.lng, a.lat, loc.lng, loc.lat)
              const bDistance = distance(b.lng, b.lat, loc.lng, loc.lat)
              return aDistance - bDistance
            })
            this.setData({ nearby, nearbyLoading: false, nearbyLoaded: true })
          })
      })
      .catch((err) => {
        this.setData({ nearbyLoading: false, nearbyLoaded: true, hasLocation: false })
        util.toast((err && err.message) || '加载附近景点失败，请检查网络')
      })
  },

  /** 引导开启定位后重新加载 */
  onEnableLocation() {
    wx.showModal({
      title: '需要定位权限',
      content: '开启定位后，可以查看附近的景点推荐。',
      confirmText: '去设置',
      confirmColor: '#0E7784',
      success: (res) => {
        if (res.confirm) {
          wx.openSetting({
            success: (r) => {
              if (r.authSetting['scope.userLocation']) {
                this.loadNearby()
              }
            }
          })
        }
      }
    })
  },

  /* ---------- 搜索 ---------- */

  onInput(e) {
    const keyword = e.detail.value || ''
    const trimmed = keyword.trim()
    if (!trimmed) {
      this.onClearKeyword()
      return
    }
    this.searchRequestId = (this.searchRequestId || 0) + 1
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.setData({ keyword, results: [], searched: true, searching: true })
    this.searchTimer = setTimeout(() => {
      if ((this.data.keyword || '').trim() === trimmed) {
        this.executeSearch(trimmed, false)
      }
    }, SEARCH_DEBOUNCE_MS)
  },

  onClearKeyword() {
    this.searchRequestId = (this.searchRequestId || 0) + 1
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.searchTimer = null
    this.setData({ keyword: '', results: [], searched: false, searching: false })
    this.loadNearby()
  },

  onBackToMap() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  onSearch() {
    const kw = (this.data.keyword || '').trim()
    if (!kw) {
      util.toast('请输入关键词')
      return
    }
    if (this.searchTimer) clearTimeout(this.searchTimer)
    this.searchTimer = null
    this.executeSearch(kw, true)
  },

  executeSearch(kw, addHistory) {
    if (addHistory) {
      storage.addHistory(kw)
      this.setData({ history: storage.getHistory() })
    }
    this.setData({ searching: true, searched: true })
    const requestId = (this.searchRequestId || 0) + 1
    this.searchRequestId = requestId

    const app = getApp()
    const locationPromise = app.globalData.location
      ? Promise.resolve(app.globalData.location)
      : app.ensureLocation()

    locationPromise
      .then((myLoc) => {
        if (myLoc) {
          return amap.searchAround(myLoc.lng, myLoc.lat, {
            keywords: kw,
            radius: SEARCH_RADIUS_M,
            offset: 50,
            sortrule: 'distance'
          }).then((list) => {
            if (list.length) return { list, myLoc }
            return amap.searchPlaces(kw, {
              city: myLoc.city || '',
              citylimit: Boolean(myLoc.city)
            }).then((fallback) => ({ list: fallback, myLoc }))
          })
        }
        return amap.searchPlaces(kw).then((list) => ({ list, myLoc: null }))
      })
      .then(({ list, myLoc }) => {
        if (requestId !== this.searchRequestId) return
        const results = list.map((p) => {
          let distanceText = ''
          if (myLoc) {
            const d = distance(p.lng, p.lat, myLoc.lng, myLoc.lat)
            distanceText = '距离当前位置约 ' + util.formatDistance(d)
          }
          return Object.assign({}, p, { distanceText })
        }).sort((a, b) => {
          if (!myLoc) return 0
          return distance(a.lng, a.lat, myLoc.lng, myLoc.lat) - distance(b.lng, b.lat, myLoc.lng, myLoc.lat)
        })
        this.setData({ results, searching: false })
      })
      .catch((err) => {
        if (requestId !== this.searchRequestId) return
        this.setData({ results: [], searching: false })
        util.toast(err.message || '搜索失败，请检查网络')
      })
  },

  onHistoryTap(e) {
    const kw = e.currentTarget.dataset.kw
    this.setData({ keyword: kw }, () => this.onSearch())
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer)
  },

  async onClearHistory() {
    const ok = await util.confirm('清空搜索历史', '确定清空全部搜索历史吗？')
    if (!ok) return
    storage.clearHistory()
    this.setData({ history: [] })
  },

  /* ---------- 列表项操作（nearby / results 共用） ---------- */

  /** 取当前点击的条目：data-from 区分数据源 */
  getItem(e) {
    const from = e.currentTarget.dataset.from
    const idx = e.currentTarget.dataset.index
    const list = from === 'nearby' ? this.data.nearby : this.data.results
    return list[idx] || null
  },

  /** 点击条目：进入景点详情 */
  onItemTap(e) {
    const item = this.getItem(e)
    if (!item) return
    getApp().globalData.pendingPlace = item
    wx.navigateTo({ url: '/pages/place-detail/place-detail' })
  },

  /** 标记为小岛 */
  onMark(e) {
    const item = this.getItem(e)
    if (!item) return
    if (!storage.isLoggedIn()) {
      util.toast('请先登录后再标记小岛')
      wx.switchTab({ url: '/pages/profile/profile' })
      return
    }
    const q = [
      'lng=' + item.lng,
      'lat=' + item.lat,
      'name=' + encodeURIComponent(item.name),
      'address=' + encodeURIComponent(item.address)
    ].join('&')
    wx.navigateTo({ url: '/pages/mark-edit/mark-edit?' + q })
  },

  /** 设为路线终点 */
  onRoute(e) {
    const item = this.getItem(e)
    if (!item) return
    getApp().globalData.pendingRouteEnd = {
      lng: item.lng,
      lat: item.lat,
      name: item.name,
      address: item.address
    }
    wx.navigateTo({ url: '/pages/route/route' })
  }
})
