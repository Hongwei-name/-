/**
 * 行屿 - 全局入口
 * 职责：
 *  1. 初始化微信云开发（失败不阻塞，核心功能本地可用）
 *  2. 用户主动登录时通过云函数获取 OpenID
 *  3. 预取用户当前位置 + 逆地理名称（供首页 / 列表排序 / 路线规划使用）
 */
const config = require('./config/index')
const storage = require('./utils/storage')
const { distance } = require('./utils/distance')
const LOGGED_OUT_KEY = 'xy:logged-out'
const LOGIN_SESSION_KEY = 'xy:login-session'
const LOGIN_SESSION_MS = 7 * 24 * 60 * 60 * 1000
const ARRIVAL_RADIUS_M = 1000

function withTimeout(promise, timeout, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeout)
    promise.then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

App({
  globalData: {
    openid: '',          // 云登录后的 openid，为空表示未登录 / 云不可用
    cloudReady: false,   // 云开发是否初始化成功
    loggedOut: false,    // 用户主动退出后，不再自动恢复云端会话
    loginRequestId: 0,
    location: null,      // { lng, lat, name } 用户当前位置
    pendingPoint: null,  // 搜索页选中的点位，供地图页 onShow 消费 { lng, lat, name, address }
    pendingPlace: null,  // 搜索页选中的 POI，供景点详情页消费
    pendingRouteEnd: null, // 待选路线终点（search 页发起路线时使用）
    arrivalMonitorActive: false,
    arrivalMonitorStarting: false,
    locationListenerBound: false,
    sessionRestorePromise: null,
    sessionExpiresAt: 0,
    sessionTimer: null,
    sessionExpiring: false,
    autoSyncing: false,
    autoSyncPending: false,
    autoSyncTimer: null
  },

  onLaunch() {
    try {
      this.globalData.loggedOut = Boolean(wx.getStorageSync(LOGGED_OUT_KEY))
    } catch (e) {}

    // 1. 初始化云开发（未开通 / 无 AppID 时静默失败）
    if (wx.cloud) {
      try {
        wx.cloud.init({
          env: config.CLOUD_ENV || undefined,
          traceUser: true
        })
        this.globalData.cloudReady = true
      } catch (e) {
        console.warn('[行屿] 云开发初始化失败，将以本地模式运行', e)
      }
    }

    // 有效期内自动恢复登录；数据仍按 OpenID 隔离保存。
    this.restoreLoginSession()
    storage.onChange(() => this.scheduleAutoBackup())

    // 2. 预取定位（不阻塞启动）
    this.ensureLocation()
  },

  onShow() {
    this.startArrivalMonitoring()
  },

  onHide() {
    this.stopArrivalMonitoring()
  },

  /**
   * 确保已登录，返回 openid（未登录 / 云不可用返回 null）
   */
  ensureLogin(expectedOpenid, userInitiated) {
    if (!this.globalData.cloudReady || this.globalData.loggedOut) return Promise.resolve(null)
    if (this.globalData.openid) {
      if (expectedOpenid && this.globalData.openid !== expectedOpenid) return Promise.resolve(null)
      return Promise.resolve(this.globalData.openid)
    }
    if (!userInitiated && !this.getValidLoginSession()) return Promise.resolve(null)
    if (this.globalData.loginPromise) return this.globalData.loginPromise

    const requestId = this.globalData.loginRequestId + 1
    this.globalData.loginRequestId = requestId
    this.globalData.loginPromise = withTimeout(
      wx.cloud.callFunction({ name: config.CLOUD_FN.LOGIN }),
      12000,
      '云端登录超时'
    )
      .then((res) => {
        if (requestId !== this.globalData.loginRequestId || this.globalData.loggedOut) return null
        const openid = (res.result && res.result.openid) || ''
        if (expectedOpenid && openid !== expectedOpenid) {
          this.clearLoginSession()
          this.globalData.loginPromise = null
          return null
        }
        this.globalData.openid = openid
        this.globalData.loginPromise = null
        // 首次登录迁移旧缓存；之后数据按 OpenID 分区保存。
        if (this.globalData.openid) {
          if (userInitiated) this.createLoginSession(this.globalData.openid)
          storage.migrateLegacyData()
          const cloud = require('./utils/cloud')
          return cloud
            .syncAll()
            .then(() => {
              this.checkIslandArrivals(this.globalData.location)
              return this.globalData.openid
            })
            .catch(() => this.globalData.openid)
        }
        return this.globalData.openid
      })
      .catch((err) => {
        if (requestId !== this.globalData.loginRequestId || this.globalData.loggedOut) return null
        console.warn('[行屿] 登录失败，数据仅保存在本地', err)
        this.globalData.openid = ''
        this.globalData.loginPromise = null
        return null
      })
    return this.globalData.loginPromise
  },

  getLoginSession() {
    try {
      const session = wx.getStorageSync(LOGIN_SESSION_KEY)
      return session && session.openid && session.expiresAt ? session : null
    } catch (e) {
      return null
    }
  },

  getValidLoginSession() {
    const session = this.getLoginSession()
    return session && Number(session.expiresAt) > Date.now() ? session : null
  },

  createLoginSession(openid) {
    const expiresAt = Date.now() + LOGIN_SESSION_MS
    try {
      wx.setStorageSync(LOGIN_SESSION_KEY, { openid, expiresAt })
    } catch (e) {}
    this.globalData.sessionExpiresAt = expiresAt
    this.scheduleSessionExpiry(expiresAt)
  },

  clearLoginSession() {
    if (this.globalData.sessionTimer) clearTimeout(this.globalData.sessionTimer)
    this.globalData.sessionTimer = null
    this.globalData.sessionExpiresAt = 0
    try {
      wx.removeStorageSync(LOGIN_SESSION_KEY)
    } catch (e) {}
  },

  restoreLoginSession() {
    if (this.globalData.sessionRestorePromise) return this.globalData.sessionRestorePromise
    const session = this.getLoginSession()
    if (!session || this.globalData.loggedOut) return Promise.resolve(null)
    if (Number(session.expiresAt) <= Date.now()) {
      this.expireLoginSession(session)
      return Promise.resolve(null)
    }
    this.globalData.sessionExpiresAt = Number(session.expiresAt)
    this.scheduleSessionExpiry(this.globalData.sessionExpiresAt)
    this.globalData.sessionRestorePromise = this.ensureLogin(session.openid, false).then(
      (openid) => openid || null,
      () => null
    ).then((openid) => {
      this.globalData.sessionRestorePromise = null
      return openid
    })
    return this.globalData.sessionRestorePromise
  },

  scheduleSessionExpiry(expiresAt) {
    if (this.globalData.sessionTimer) clearTimeout(this.globalData.sessionTimer)
    const delay = Math.max(0, Number(expiresAt) - Date.now())
    this.globalData.sessionTimer = setTimeout(() => this.expireLoginSession(), delay)
  },

  expireLoginSession(sessionArg) {
    const session = sessionArg || this.getLoginSession()
    if (!session || Number(session.expiresAt) > Date.now() || this.globalData.sessionExpiring) return
    this.globalData.sessionExpiring = true
    const finish = () => {
      this.clearLoginSession()
      this.globalData.openid = ''
      this.globalData.sessionExpiring = false
      wx.showToast({ title: '登录已过期，请重新登录', icon: 'none' })
    }
    // 应用仍在前台且身份一致时，先完成最后一次备份再失效登录态。
    if (this.globalData.openid === session.openid) {
      require('./utils/cloud').syncAll().catch(() => {}).then(finish)
    } else {
      finish()
    }
  },

  scheduleAutoBackup() {
    const session = this.getValidLoginSession()
    if (!session || this.globalData.openid !== session.openid || this.globalData.sessionExpiring) return
    if (this.globalData.autoSyncing) {
      this.globalData.autoSyncPending = true
      return
    }
    if (this.globalData.autoSyncTimer) clearTimeout(this.globalData.autoSyncTimer)
    this.globalData.autoSyncTimer = setTimeout(() => {
      this.globalData.autoSyncTimer = null
      this.globalData.autoSyncing = true
      require('./utils/cloud').syncAll().catch(() => {}).then(() => {
        this.globalData.autoSyncing = false
        if (this.globalData.autoSyncPending) {
          this.globalData.autoSyncPending = false
          this.scheduleAutoBackup()
        }
      })
    }, 1500)
  },

  /** 停止本机云端会话；调用方会在此之前清除本机账号缓存。 */
  logout() {
    this.globalData.loginRequestId += 1
    this.globalData.loginPromise = null
    this.globalData.openid = ''
    this.globalData.loggedOut = true
    this.clearLoginSession()
    try {
      wx.setStorageSync(LOGGED_OUT_KEY, true)
    } catch (e) {}
  },

  /** 用户主动登录后恢复当前微信账号的云端会话。 */
  resumeLogin() {
    this.globalData.loggedOut = false
    try {
      wx.removeStorageSync(LOGGED_OUT_KEY)
    } catch (e) {}
    return this.ensureLogin('', true)
  },

  /** 由用户操作恢复当前微信会话对应的云开发 OpenID 会话。 */
  loginWithWechat() {
    return this.resumeLogin()
  },

  /** 在前台监听位置变化；后台定位不在本应用权限范围内。 */
  startArrivalMonitoring() {
    if (
      !wx.startLocationUpdate ||
      !wx.onLocationChange ||
      this.globalData.arrivalMonitorActive ||
      this.globalData.arrivalMonitorStarting
    ) return

    if (!this.globalData.locationListenerBound) {
      wx.onLocationChange((res) => {
        const lng = Number(res && res.longitude)
        const lat = Number(res && res.latitude)
        if (!isValidCoordinate(lng, lat)) return
        this.globalData.location = Object.assign({}, this.globalData.location || {}, { lng, lat })
        this.checkIslandArrivals(this.globalData.location)
      })
      this.globalData.locationListenerBound = true
    }

    this.globalData.arrivalMonitorStarting = true
    wx.startLocationUpdate({
      success: () => {
        this.globalData.arrivalMonitorActive = true
        this.globalData.arrivalMonitorStarting = false
      },
      fail: () => {
        this.globalData.arrivalMonitorStarting = false
      }
    })
  },

  stopArrivalMonitoring() {
    if (!this.globalData.arrivalMonitorActive || !wx.stopLocationUpdate) return
    wx.stopLocationUpdate({ complete: () => { this.globalData.arrivalMonitorActive = false } })
  },

  /** 将进入一公里范围内的未到达小岛标记为已到达。 */
  checkIslandArrivals(location) {
    if (!storage.isLoggedIn() || !location || !isValidCoordinate(location.lng, location.lat)) return []
    const arrived = storage.getIslands().filter((island) => {
      return !island.visited &&
        isValidCoordinate(island.lng, island.lat) &&
        distance(location.lng, location.lat, island.lng, island.lat) <= ARRIVAL_RADIUS_M
    })
    if (!arrived.length) return []

    const now = Date.now()
    arrived.forEach((island) => {
      storage.updateIsland(island.id, { visited: true, visitedAt: now, arrivedAt: now })
    })
    wx.showToast({ title: '已到达 ' + arrived.length + ' 处', icon: 'success' })
    require('./utils/cloud').syncAll().catch(() => {})
    return arrived
  },

  /**
   * 获取用户当前位置（经纬度 + 高德逆地理位置名），成功写入 globalData.location
   * 拒绝授权时返回 null，不抛错
   */
  ensureLocation(forceRefresh) {
    if (!forceRefresh && this.globalData.location) {
      return Promise.resolve(this.globalData.location)
    }
    if (this.globalData.locationPromise) return this.globalData.locationPromise

    this.globalData.locationPromise = new Promise((resolve) => {
      wx.getLocation({
        type: 'gcj02',
        success: (res) => {
          const loc = { lng: res.longitude, lat: res.latitude, name: '' }
          // 逆地理拿位置名（高德）
          const amap = require('./utils/amap')
          amap
            .regeo(loc.lng, loc.lat)
            .then((data) => {
              loc.name = (data && data.formatted_address) || ''
              loc.city = (data && data.city) || ''
              this.globalData.location = loc
              this.checkIslandArrivals(loc)
              this.startArrivalMonitoring()
              this.globalData.locationPromise = null
              resolve(loc)
            })
            .catch(() => {
              this.globalData.location = loc
              this.checkIslandArrivals(loc)
              this.startArrivalMonitoring()
              this.globalData.locationPromise = null
              resolve(loc)
            })
        },
        fail: () => {
          console.warn('[行屿] 未获取到定位（可能拒绝授权）')
          this.globalData.locationPromise = null
          resolve(null)
        }
      })
    })
    return this.globalData.locationPromise
  },

  /**
   * 读取当前定位（优先缓存，其次实时获取）
   */
  getLocation() {
    if (this.globalData.location) {
      this.checkIslandArrivals(this.globalData.location)
      this.startArrivalMonitoring()
      return Promise.resolve(this.globalData.location)
    }
    return this.ensureLocation()
  }
})

function isValidCoordinate(lng, lat) {
  return Number.isFinite(Number(lng)) && Number.isFinite(Number(lat)) &&
    Number(lng) >= -180 && Number(lng) <= 180 && Number(lat) >= -90 && Number(lat) <= 90
}
