const storage = require('../../utils/storage')
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    profile: null,
    islandCount: 0,
    photoCount: 0,
    cloudReady: false,
    authorizing: false
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 2, visible: true })
    this.refresh()
  },

  refresh() {
    const app = getApp()
    this.setData({
      profile: storage.getProfile(),
      islandCount: storage.getIslands().length,
      photoCount: storage.getPhotos().length,
      cloudReady: Boolean(app.globalData.openid)
    })
    app.ensureLogin().then((openid) => {
      this.setData({ cloudReady: Boolean(openid) })
    })
  },

  onAuthorize() {
    if (this.data.authorizing) return
    if (!wx.getUserProfile) {
      util.toast('当前微信版本不支持授权，请升级微信后重试')
      return
    }
    this.setData({ authorizing: true })
    wx.getUserProfile({
      desc: '用于展示您的微信头像和昵称',
      success: (res) => {
        const userInfo = res.userInfo || {}
        storage.saveProfile({
          nickName: userInfo.nickName || '微信用户',
          avatarUrl: userInfo.avatarUrl || ''
        })
        getApp()
          .ensureLogin()
          .then(() => {
            this.setData({ authorizing: false })
            this.refresh()
            util.toast('微信授权成功', 'success')
          })
          .catch(() => {
            this.setData({ authorizing: false })
            this.refresh()
            util.toast('资料已授权，本地模式可继续使用')
          })
      },
      fail: (err) => {
        this.setData({ authorizing: false })
        if (!/cancel/i.test((err && err.errMsg) || '')) {
          util.toast('授权未完成，请稍后重试')
        }
      }
    })
  },

  goIslands() {
    wx.navigateTo({ url: '/pages/islands/islands' })
  },

  goPhotos() {
    wx.navigateTo({ url: '/pages/photo-import/photo-import' })
  },

  goTour() {
    wx.navigateTo({ url: '/pages/tour/tour' })
  },

  onSync() {
    if (!cloud.isAvailable()) {
      util.toast('云开发未开通，数据仅保存在本地')
      return
    }
    wx.showLoading({ title: '同步中', mask: true })
    cloud.syncAll().then((res) => {
      wx.hideLoading()
      if (res.ok) {
        this.refresh()
        util.toast('云端同步完成', 'success')
      } else {
        util.toast('同步失败，请检查网络')
      }
    })
  }
})
