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
    profileFormReady: false,
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
    const requestId = (this.profileRequestId || 0) + 1
    this.profileRequestId = requestId
    this.setData({
      profile: storage.getProfile(),
      profileFormReady: Boolean(storage.getProfile()),
      islandCount: storage.getIslands().length,
      photoCount: storage.getPhotos().length,
      cloudReady: Boolean(app.globalData.openid)
    })
    app.ensureLogin().then((openid) => {
      if (requestId !== this.profileRequestId) return null
      this.setData({ cloudReady: Boolean(openid) })
      if (!openid) return null
      return cloud.pullProfile()
    }).then((remoteProfile) => {
      if (requestId !== this.profileRequestId || !remoteProfile) return
      const localProfile = storage.getProfile()
      if (!localProfile || (remoteProfile.updatedAt || 0) > (localProfile.updatedAt || 0)) {
        const profile = storage.replaceProfile(remoteProfile)
        this.setData({
          profile,
          profileFormReady: true,
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

  /** 用户主动确认后建立当前微信账号的云端身份会话。 */
  onWechatLogin() {
    if (this.data.authorizing) return
    this.setData({ authorizing: true })
    getApp()
      .resumeLogin()
      .then((openid) => {
        this.setData({ authorizing: false, cloudReady: Boolean(openid) })
        if (!openid) {
          util.toast('微信登录失败，请稍后重试')
          return
        }
        this.setData({ profileFormReady: true })
        util.toast('登录成功，请完善头像和昵称', 'success')
      })
      .catch(() => {
        this.setData({ authorizing: false })
        util.toast('微信登录失败，请稍后重试')
      })
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
      .resumeLogin()
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
  },

  async onLogout() {
    const ok = await util.confirm('退出登录', '将清除本机头像、昵称和云端会话。本机小岛、照片及云端数据不会被删除。')
    if (!ok) return
    this.profileRequestId = (this.profileRequestId || 0) + 1
    getApp().logout()
    storage.clearProfile()
    this.setData({
      profile: null,
      cloudReady: false,
      profileFormReady: false,
      draftNickName: '',
      draftAvatarUrl: ''
    })
    util.toast('已退出登录')
  }
})
