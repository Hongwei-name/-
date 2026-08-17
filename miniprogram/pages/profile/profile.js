const storage = require('../../utils/storage')
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

Page({
  data: {
    profile: null,
    islandCount: 0,
    photoCount: 0,
    cloudReady: false,
    authorizing: false,
    draftNickName: '',
    draftAvatarUrl: ''
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
      if (!openid) return null
      return cloud.pullProfile()
    }).then((remoteProfile) => {
      if (!remoteProfile) return
      const localProfile = storage.getProfile()
      if (!localProfile || (remoteProfile.updatedAt || 0) > (localProfile.updatedAt || 0)) {
        const profile = storage.replaceProfile(remoteProfile)
        this.setData({
          profile,
          draftNickName: profile.nickName,
          draftAvatarUrl: profile.avatarUrl
        })
      } else if ((localProfile.updatedAt || 0) > (remoteProfile.updatedAt || 0)) {
        cloud.syncProfile(localProfile)
      }
    }).catch(() => {})
    const profile = storage.getProfile()
    this.setData({
      draftNickName: profile ? profile.nickName : '',
      draftAvatarUrl: profile ? profile.avatarUrl : ''
    })
  },

  onChooseAvatar(e) {
    const avatarUrl = e.detail && e.detail.avatarUrl
    if (avatarUrl) this.setData({ draftAvatarUrl: avatarUrl })
  },

  onNickNameInput(e) {
    this.setData({ draftNickName: e.detail.value })
  },

  onSaveProfile() {
    if (this.data.authorizing) return
    const nickName = (this.data.draftNickName || '').trim()
    if (!nickName) {
      util.toast('请填写昵称')
      return
    }
    this.setData({ authorizing: true })
    const profile = storage.saveProfile({
      nickName,
      avatarUrl: this.data.draftAvatarUrl || ''
    })
    getApp()
      .ensureLogin()
      .then((openid) => (openid ? cloud.syncProfile(profile) : { ok: false }))
      .then((result) => {
        this.setData({ authorizing: false, profile })
        util.toast(result.ok ? '资料已保存并同步' : '资料已保存到本机', result.ok ? 'success' : 'none')
      })
      .catch(() => {
        this.setData({ authorizing: false, profile })
        util.toast('资料已保存到本机')
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
    Promise.all([cloud.syncAll(), cloud.syncProfile(storage.getProfile())]).then(([res, profileRes]) => {
      wx.hideLoading()
      if (res.ok && profileRes.ok) {
        this.refresh()
        util.toast('云端同步完成', 'success')
      } else {
        util.toast('同步失败，请检查网络')
      }
    })
  }
})
