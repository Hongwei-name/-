/**
 * 地图首页
 *  - 展示用户当前位置、已标记小岛（区分样式）、临时选点
 *  - 点击地图任意位置：逆地理解析点位信息，支持直接标记为小岛 / 设为路线终点
 *  - 点击小岛 marker：查看详情 / 路线规划 / 编辑 / 删除
 */
const amap = require('../../utils/amap')
const storage = require('../../utils/storage')
const util = require('../../utils/util')

const DEFAULT_SCALE = 17
const PHOTO_CALLOUT_SCALE = 18
const PHOTO_CALLOUT_LIMIT = 4

Page({
  data: {
    navigationHeight: 64,
    latitude: 39.908823, // 默认北京，定位后更新
    longitude: 116.39747,
    scale: DEFAULT_SCALE,
    markers: [],
    photoCallouts: [],
    polylines: [],
    locating: false,     // 定位中（右上角小型菊花）
    showPanel: false,
    activePoint: null,   // 普通点位 {lng, lat, name, address, id}
    activePointId: '',
    nearbyPois: [],
    activeIsland: null,  // 已标记小岛
    photoCount: 0
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = info.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect()
    const navigationHeight = menuButton
      ? menuButton.bottom + (menuButton.top - statusBarHeight) + 16
      : statusBarHeight + 60
    this.setData({ navigationHeight })
    this.mapCtx = null

    // 数据变化时刷新地图标记
    this.offStorage = storage.onChange(() => {
      this.buildMarkers()
      this.refreshActiveIsland()
    })

    // 预取定位（右上角显示定位中状态，成功后轻提示）
    this.setData({ locating: true })
    getApp()
      .getLocation()
      .then((loc) => {
        this.setData({ locating: false })
        if (loc) {
          this.applyLocation(loc)
        } else {
          util.toast('定位失败，请检查定位权限')
        }
      })
  },

  onReady() {
    this.mapCtx = wx.createMapContext('map', this)
  },

  onShow() {
    // 同步自定义 tabBar 选中态
    if (this.getTabBar) {
      this.getTabBar().setData({ selected: 0, visible: !this.data.showPanel })
    }
    // 消费搜索页带过来的点位：定位 + 展示信息面板
    const app = getApp()
    if (app.globalData.pendingPoint) {
      const pt = app.globalData.pendingPoint
      app.globalData.pendingPoint = null
      this.showPoint({
        lng: pt.lng,
        lat: pt.lat,
        name: pt.name || '所选位置',
        address: pt.address || '',
        id: pt.id || ''
      })
    }
    this.buildMarkers()
  },

  onUnload() {
    if (this.offStorage) this.offStorage()
  },

  /* ---------- 定位 ---------- */

  applyLocation(loc) {
    this.setData({ latitude: loc.lat, longitude: loc.lng })
    this.buildMarkers()
  },

  onLocateTap() {
    if (this.data.locating) return
    this.setData({ locating: true })
    getApp()
      .ensureLocation(true)
      .then((loc) => {
        this.setData({ locating: false })
        if (!loc) {
          util.toast('定位失败，请检查定位权限')
          this.openSetting('定位')
          return
        }
        this.applyLocation(loc)
        if (this.mapCtx) {
          this.mapCtx.moveToLocation({ longitude: loc.lng, latitude: loc.lat })
        }
        util.toast('已定位到当前位置', 'none')
      })
  },

  /* ---------- 地图标记 ---------- */

  buildMarkers() {
    const app = getApp()
    const markers = []

    // 当前位置（尖底图钉，锚点对准尖端）
    if (app.globalData.location && isValidCoordinate(app.globalData.location.lng, app.globalData.location.lat)) {
      const loc = app.globalData.location
      markers.push({
        id: 0,
        latitude: loc.lat,
        longitude: loc.lng,
        iconPath: '/images/marker-current.png',
        width: 40,
        height: 40,
        anchor: { x: 0.5, y: 1 },
        zIndex: 10
      })
    }

    // 已标记小岛（红色线性图钉 + 名称标签）
    const islands = storage.getIslands()
    const photoCallouts = []
    const showPhotoCallouts = Number(this.data.scale) >= PHOTO_CALLOUT_SCALE
    islands.forEach((isl, i) => {
      if (!isValidCoordinate(isl.lng, isl.lat)) return
      const markerId = 1000 + i
      const photos = storage
        .getPhotosByIsland(isl.id)
        .filter((photo) => photo && photo.localPath)
      const marker = {
        id: markerId,
        latitude: isl.lat,
        longitude: isl.lng,
        iconPath: '/images/marker-island.png',
        width: 34,
        height: 50,
        anchor: { x: 0.5, y: 1 },
        zIndex: 5,
        label: {
          content: isl.name,
          color: '#1F2733',
          fontSize: 11,
          bgColor: '#FFFFFF',
          borderRadius: 8,
          padding: 4,
          anchorX: -30,
          anchorY: -60
        }
      }
      if (showPhotoCallouts && photos.length) {
        const previewPhotos = photos.slice(0, PHOTO_CALLOUT_LIMIT)
        marker.customCallout = {
          display: 'ALWAYS',
          // customCallout 的偏移单位为 px，按卡片尺寸将中心对齐到 marker。
          anchorX: -75,
          anchorY: -62
        }
        photoCallouts.push({
          markerId,
          islandId: isl.id,
          name: isl.name,
          photos: previewPhotos,
          moreCount: Math.max(photos.length - previewPhotos.length, 0)
        })
      }
      markers.push(marker)
    })

    // 临时选点（蓝色线性图钉）
    if (this.data.activePoint && !this.data.activeIsland && isValidCoordinate(this.data.activePoint.lng, this.data.activePoint.lat)) {
      markers.push({
        id: 8888,
        latitude: this.data.activePoint.lat,
        longitude: this.data.activePoint.lng,
        iconPath: '/images/marker-point.png',
        width: 34,
        height: 50,
        anchor: { x: 0.5, y: 1 },
        zIndex: 8
      })
    }

    this.setData({ markers, photoCallouts })
  },

  setTabBarVisible(visible) {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ visible })
  },

  /* ---------- 地图交互 ---------- */

  /** 点击地图空白处 -> 逆地理解析点位 */
  onMapTap(e) {
    const { longitude, latitude } = e.detail || {}
    if (!isValidCoordinate(longitude, latitude)) return
    this.resolveMapPoint(longitude, latitude)
  },

  /** 点击地图底图上的店铺 / 景点名称（map 组件的 POI 专用事件） */
  onMapPoiTap(e) {
    const detail = e.detail || {}
    const longitude = detail.longitude
    const latitude = detail.latitude
    if (!isValidCoordinate(longitude, latitude)) return
    this.resolveMapPoint(longitude, latitude, {
      name: detail.name || '所选位置',
      address: detail.address || '',
      id: detail.poiId || detail.id || ''
    })
  },

  /** 地图缩放结束后，按街区级别切换照片缩略图气泡 */
  onMapRegionChange(e) {
    const detail = e.detail || {}
    // 只接收用户手势结束事件；setData / moveToLocation 触发的 update
    // 回调不能再次覆盖中心，否则地图会在缩放后跳回旧位置。
    if (detail.type !== 'end' || detail.causedBy !== 'gesture') return
    const nextScale = Number(detail.scale)
    const nextLatitude = Number(detail.latitude)
    const nextLongitude = Number(detail.longitude)
    if (!Number.isFinite(nextScale)) return

    const scaleChanged = nextScale !== this.data.scale
    const centerChanged =
      isValidCoordinate(nextLongitude, nextLatitude) &&
      (nextLatitude !== this.data.latitude || nextLongitude !== this.data.longitude)
    if (!scaleChanged && !centerChanged) return

    const wasShowingPhotoCallouts = this.data.scale >= PHOTO_CALLOUT_SCALE
    const willShowPhotoCallouts = nextScale >= PHOTO_CALLOUT_SCALE
    const nextData = { scale: nextScale }
    if (centerChanged) {
      nextData.latitude = nextLatitude
      nextData.longitude = nextLongitude
    }
    this.setData(nextData, () => {
      // 缩放过程中不重建所有 marker，只在照片气泡需要显隐时刷新一次。
      if (wasShowingPhotoCallouts !== willShowPhotoCallouts) this.buildMarkers()
    })
  },

  /** 点击照片气泡直接进入对应小岛详情，查看完整照片集 */
  onPhotoCalloutTap(e) {
    const islandId = e.currentTarget.dataset.islandId
    const island = storage.getIsland(islandId)
    if (island) wx.navigateTo({ url: '/pages/island-detail/island-detail?id=' + island.id })
  },

  /** 解析地图点位；POI 点击时保留底图返回的名称作为兜底 */
  resolveMapPoint(longitude, latitude, fallback) {
    const hasFallback = Boolean(fallback)
    const defaultPoint = Object.assign({
      name: '所选位置',
      address: '',
      id: ''
    }, fallback || {})
    amap
      .regeo(longitude, latitude)
      .then((info) => {
        const poi = info.pois && info.pois.length ? info.pois[0] : null
        this.showPoint({
          lng: longitude,
          lat: latitude,
          name: defaultPoint.name !== '所选位置' ? defaultPoint.name : ((poi && poi.name) || info.formatted_address || defaultPoint.name),
          address: defaultPoint.address || (poi && poi.address) || info.formatted_address || '',
          id: defaultPoint.id || (poi && poi.id) || '',
          nearbyPois: info.pois || []
        })
      })
      .catch((err) => {
        if (hasFallback) {
          // POI 点击即使无法联网，也要打开面板显示地图返回的名称。
          this.showPoint({
            lng: longitude,
            lat: latitude,
            name: defaultPoint.name,
            address: defaultPoint.address,
            id: defaultPoint.id
          })
          util.toast(err.message || '解析失败，已显示所选位置')
          return
        }
        util.toast(err.message || '解析失败，请检查网络')
      })
  },

  /** 点击附近 POI -> 切换选点 */
  onPoiTap(e) {
    const idx = e.currentTarget.dataset.index
    const poi = this.data.nearbyPois[idx]
    if (!poi) return
    this.setData({
      activePoint: {
        lng: poi.lng,
        lat: poi.lat,
        name: poi.name,
        address: poi.address,
        id: poi.id
      },
      activePointId: poi.id
    })
    this.buildMarkers()
    if (this.mapCtx) {
      this.mapCtx.moveToLocation({ longitude: poi.lng, latitude: poi.lat })
    }
  },

  /** 点击 marker */
  onMarkerTap(e) {
    const markerId = e.detail && e.detail.markerId
    if (markerId === 0 || markerId === 8888) return // 当前位置 / 临时点

    const islands = storage.getIslands()
    const idx = markerId - 1000
    const island = islands[idx]
    if (island) this.showIsland(island)
  },

  /** 展示普通点位面板 */
  showPoint(point) {
    if (!isValidCoordinate(point.lng, point.lat)) {
      util.toast('该地点坐标无效')
      return
    }
    this.setData({
      showPanel: true,
      latitude: point.lat,
      longitude: point.lng,
      scale: DEFAULT_SCALE,
      activeIsland: null,
      activePoint: {
        lng: point.lng,
        lat: point.lat,
        name: point.name,
        address: point.address,
        id: point.id
      },
      activePointId: point.id || '',
      nearbyPois: point.nearbyPois || []
    })
    this.setTabBarVisible(false)
    this.buildMarkers()
    if (this.mapCtx) {
      this.mapCtx.moveToLocation({ longitude: point.lng, latitude: point.lat })
    }
  },

  /** 展示小岛面板 */
  showIsland(island) {
    const photos = storage.getPhotosByIsland(island.id)
    this.setData({
      showPanel: true,
      activePoint: null,
      activeIsland: Object.assign({}, island, {
        createdAtText: util.formatTime(island.createdAt),
        photos: photos.filter((photo) => photo && photo.localPath)
      }),
      photoCount: photos.length
    })
    this.setTabBarVisible(false)
    this.buildMarkers()
  },

  /** 预览当前小岛归集的全部本地照片 */
  previewIslandPhoto(e) {
    const photos = (this.data.activeIsland && this.data.activeIsland.photos) || []
    const index = Number(e.currentTarget.dataset.index)
    const current = photos[index]
    if (!current || !current.localPath) return
    const urls = photos.filter((photo) => photo && photo.localPath).map((photo) => photo.localPath)
    wx.previewImage({ current: current.localPath, urls })
  },

  /** 面板打开期间小岛数据可能变化，同步刷新 */
  refreshActiveIsland() {
    const island = this.data.activeIsland
    if (!island) return
    const fresh = storage.getIsland(island.id)
    if (!fresh) {
      this.closePanel()
      return
    }
    this.showIsland(fresh)
  },

  closePanel() {
    this.setData({ showPanel: false, activePoint: null, activeIsland: null })
    this.setTabBarVisible(true)
    this.buildMarkers()
  },

  /* ---------- 面板操作 ---------- */

  /** 标记为我的小岛 */
  markAsIsland() {
    const p = this.data.activePoint
    if (!p) return
    if (!storage.isLoggedIn()) {
      util.toast('请先登录后再标记小岛')
      this.closePanel()
      wx.switchTab({ url: '/pages/profile/profile' })
      return
    }
    const q = [
      'lng=' + p.lng,
      'lat=' + p.lat,
      'name=' + encodeURIComponent(p.name || ''),
      'address=' + encodeURIComponent(p.address || '')
    ].join('&')
    wx.navigateTo({ url: '/pages/mark-edit/mark-edit?' + q })
  },

  routeFromPoint() {
    const p = this.data.activePoint
    if (!p) return
    getApp().globalData.pendingRouteEnd = {
      lng: p.lng,
      lat: p.lat,
      name: p.name,
      address: p.address
    }
    wx.navigateTo({ url: '/pages/route/route' })
  },

  routeToIsland() {
    const island = this.data.activeIsland
    if (!island) return
    wx.navigateTo({ url: '/pages/route/route?endId=' + island.id })
  },

  viewIslandDetail() {
    const island = this.data.activeIsland
    if (!island) return
    wx.navigateTo({ url: '/pages/island-detail/island-detail?id=' + island.id })
  },

  editIsland() {
    const island = this.data.activeIsland
    if (!island) return
    wx.navigateTo({ url: '/pages/mark-edit/mark-edit?id=' + island.id })
  },

  async deleteIsland() {
    const island = this.data.activeIsland
    if (!island) return
    const ok = await util.confirm('删除小岛', '确定删除「' + island.name + '」吗？其下归集的照片关联也会一并解除（原图不会被删除）。')
    if (!ok) return
    storage.deleteIsland(island.id)
    util.toast('已删除')
    this.closePanel()
  },

  /* ---------- 跳转 ---------- */

  goSearch() {
    wx.navigateTo({ url: '/pages/search/search' })
  },

  goPhotoImport() {
    if (!storage.isLoggedIn()) {
      util.toast('请先登录后再归集照片')
      wx.switchTab({ url: '/pages/profile/profile' })
      return
    }
    wx.navigateTo({ url: '/pages/photo-gallery/photo-gallery' })
  },

  /** 引导用户去设置页打开权限 */
  openSetting(scene) {
    wx.showModal({
      title: '需要' + scene + '权限',
      content: '请在设置中允许「行屿」使用位置信息，否则相关功能不可用。',
      confirmText: '去设置',
      confirmColor: '#2B5CD9',
      success: (res) => {
        if (res.confirm) {
          wx.openSetting()
        }
      }
    })
  }
})

function isValidCoordinate(lng, lat) {
  if (lng === null || lng === undefined || lat === null || lat === undefined || lng === '' || lat === '') return false
  const longitude = Number(lng)
  const latitude = Number(lat)
  return Number.isFinite(longitude) && Number.isFinite(latitude) && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90
}
