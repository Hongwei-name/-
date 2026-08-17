/**
 * 行屿 - 全局入口
 * 职责：
 *  1. 初始化微信云开发（失败不阻塞，核心功能本地可用）
 *  2. 用户主动登录时通过云函数获取 OpenID
 *  3. 预取用户当前位置 + 逆地理名称（供首页 / 列表排序 / 路线规划使用）
 */
const config = require('./config/index')
const storage = require('./utils/storage')
const LOGGED_OUT_KEY = 'xy:logged-out'

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
    pendingRouteEnd: null // 待选路线终点（search 页发起路线时使用）
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

    // 2. 预取定位（不阻塞启动）
    this.ensureLocation()
  },

  /**
   * 确保已登录，返回 openid（未登录 / 云不可用返回 null）
   */
  ensureLogin() {
    if (!this.globalData.cloudReady || this.globalData.loggedOut) return Promise.resolve(null)
    if (this.globalData.openid) return Promise.resolve(this.globalData.openid)
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
        this.globalData.openid = (res.result && res.result.openid) || ''
        this.globalData.loginPromise = null
        // 首次登录迁移旧缓存；之后数据按 OpenID 分区保存。
        if (this.globalData.openid) {
          storage.migrateLegacyData()
          const cloud = require('./utils/cloud')
          cloud.syncAll().catch(() => {})
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

  /** 停止本机云端会话；调用方会在此之前清除本机账号缓存。 */
  logout() {
    this.globalData.loginRequestId += 1
    this.globalData.loginPromise = null
    this.globalData.openid = ''
    this.globalData.loggedOut = true
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
    return this.ensureLogin()
  },

  /** 由用户操作恢复当前微信会话对应的云开发 OpenID 会话。 */
  loginWithWechat() {
    return this.resumeLogin()
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
              this.globalData.locationPromise = null
              resolve(loc)
            })
            .catch(() => {
              this.globalData.location = loc
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
    if (this.globalData.location) return Promise.resolve(this.globalData.location)
    return this.ensureLocation()
  }
})
