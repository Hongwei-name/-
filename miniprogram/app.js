/**
 * 行屿 - 全局入口
 * 职责：
 *  1. 初始化微信云开发（失败不阻塞，核心功能本地可用）
 *  2. 静默登录（云函数 login 换取 openid）
 *  3. 预取用户当前位置 + 逆地理名称（供首页 / 列表排序 / 路线规划使用）
 */
const config = require('./config/index')

App({
  globalData: {
    openid: '',          // 云登录后的 openid，为空表示未登录 / 云不可用
    cloudReady: false,   // 云开发是否初始化成功
    location: null,      // { lng, lat, name } 用户当前位置
    pendingPoint: null,  // 搜索页选中的点位，供地图页 onShow 消费 { lng, lat, name, address }
    pendingRouteEnd: null // 待选路线终点（search 页发起路线时使用）
  },

  onLaunch() {
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

    // 2. 静默登录（不阻塞启动）
    this.ensureLogin()

    // 3. 预取定位（不阻塞启动）
    this.ensureLocation()
  },

  /**
   * 确保已登录，返回 openid（未登录 / 云不可用返回 null）
   */
  ensureLogin() {
    if (!this.globalData.cloudReady) return Promise.resolve(null)
    if (this.globalData.openid) return Promise.resolve(this.globalData.openid)
    if (this.globalData.loginPromise) return this.globalData.loginPromise

    this.globalData.loginPromise = wx.cloud
      .callFunction({ name: config.CLOUD_FN.LOGIN })
      .then((res) => {
        this.globalData.openid = (res.result && res.result.openid) || ''
        this.globalData.loginPromise = null
        // 登录成功后静默全量同步一次（云端备份）
        if (this.globalData.openid) {
          const cloud = require('./utils/cloud')
          cloud.syncAll().catch(() => {})
        }
        return this.globalData.openid
      })
      .catch((err) => {
        console.warn('[行屿] 登录失败，数据仅保存在本地', err)
        this.globalData.openid = ''
        this.globalData.loginPromise = null
        return null
      })
    return this.globalData.loginPromise
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
              loc.name = (data && data.regeocode && data.regeocode.formatted_address) || ''
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
