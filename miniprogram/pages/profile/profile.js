const storage = require('../../utils/storage')
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

const DEFAULT_AVATAR_URL = 'https://free.picui.cn/free/2026/08/18/6a83c33d794fc.png'

Page({
  data: {
    profile: null,
    islandCount: 0,
    photoCount: 0,
    cloudReady: false,
    authorizing: false,
    profileFormReady: false,
    showProfileEditor: false,
    avatarError: false,
    draftNickName: '',
    draftAvatarUrl: '',
    defaultAvatarUrl: DEFAULT_AVATAR_URL
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 2, visible: true })
    const app = getApp()
    const restored = app.restoreLoginSession ? app.restoreLoginSession() : Promise.resolve()
    restored.then(() => this.refresh())
  },

  refresh() {
    const app = getApp()
    const loggedIn = Boolean(app.globalData.openid)
    const requestId = (this.profileRequestId || 0) + 1
    this.profileRequestId = requestId
    this.setData({
      profile: storage.getProfile(),
      profileFormReady: Boolean(storage.getProfile()),
      showProfileEditor: false,
      avatarError: false,
      islandCount: storage.getIslands().length,
      photoCount: storage.getPhotos().length,
      cloudReady: loggedIn
    })
    if (!loggedIn) {
      this.setDraftFromProfile()
      return
    }
    cloud.pullProfile().then((remoteProfile) => {
      if (requestId !== this.profileRequestId) return null
      if (!remoteProfile) return
      const localProfile = storage.getProfile()
      if (!localProfile || (remoteProfile.updatedAt || 0) > (localProfile.updatedAt || 0)) {
        const profile = storage.replaceProfile(remoteProfile)
        this.setData({
          profile,
          profileFormReady: true,
          showProfileEditor: false,
          draftNickName: profile.nickName,
          draftAvatarUrl: profile.avatarUrl || DEFAULT_AVATAR_URL
        })
      } else if ((localProfile.updatedAt || 0) > (remoteProfile.updatedAt || 0)) {
        cloud.syncProfile(localProfile)
      }
    }).catch(() => {})
    this.setDraftFromProfile()
  },

  setDraftFromProfile() {
    const profile = storage.getProfile()
    this.setData({
      draftNickName: profile ? profile.nickName : '',
      draftAvatarUrl: profile && profile.avatarUrl ? profile.avatarUrl : DEFAULT_AVATAR_URL
    })
  },

  onChooseAvatar(e) {
    const avatarUrl = e.detail && e.detail.avatarUrl
    if (!avatarUrl || this.data.authorizing) return
    this.setData({ authorizing: true })
    wx.saveFile({
      tempFilePath: avatarUrl,
      success: (res) => {
        this.setData({ draftAvatarUrl: res.savedFilePath, avatarError: false, authorizing: false })
      },
      fail: () => {
        this.setData({ authorizing: false })
        util.toast('头像保存失败，请重新选择')
      }
    })
  },

  onAvatarError() {
    this.setData({ avatarError: true })
  },

  onNickNameInput(e) {
    this.setData({ draftNickName: e.detail.value })
  },

  /** 用户主动确认后建立当前微信账号的云端身份会话。 */
  onWechatLogin() {
    if (this.data.authorizing) return
    this.setData({ authorizing: true })
    getApp()
      .loginWithWechat()
      .then((openid) => {
        this.setData({
          authorizing: false,
          cloudReady: Boolean(openid),
          islandCount: storage.getIslands().length,
          photoCount: storage.getPhotos().length
        })
        if (!openid) {
          util.toast('微信登录失败，请稍后重试')
          return
        }
        return cloud.pullProfile().catch(() => null).then((remoteProfile) => {
          if (remoteProfile) {
            const profile = storage.replaceProfile(remoteProfile)
            this.setData({
              profile,
              profileFormReady: true,
              showProfileEditor: false,
              draftNickName: profile.nickName,
              draftAvatarUrl: profile.avatarUrl || DEFAULT_AVATAR_URL
            })
            util.toast('微信登录成功', 'success')
          } else {
            const profile = storage.getProfile()
            this.setData({
              profile,
              profileFormReady: Boolean(profile),
              showProfileEditor: !profile,
              draftNickName: profile ? profile.nickName : '',
              draftAvatarUrl: profile && profile.avatarUrl ? profile.avatarUrl : DEFAULT_AVATAR_URL
            })
            util.toast(profile ? '微信登录成功' : '微信登录成功，请完善资料', 'success')
          }
        })
      })
      .catch((err) => {
        this.setData({ authorizing: false })
        util.toast(/超时|timeout/i.test((err && err.message) || '') ? '登录超时，请稍后重试' : '微信登录失败，请稍后重试')
      })
  },

  onEditProfile() {
    this.setData({ showProfileEditor: true })
  },

  onCancelProfileEdit() {
    const profile = this.data.profile
    this.setData({
      showProfileEditor: false,
      draftNickName: profile ? profile.nickName : '',
      draftAvatarUrl: profile && profile.avatarUrl ? profile.avatarUrl : DEFAULT_AVATAR_URL
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
      .loginWithWechat()
      .then((openid) => (openid ? cloud.syncProfile(profile) : { ok: false }))
      .then((result) => {
        this.setData({ authorizing: false, profile, profileFormReady: true, showProfileEditor: false, cloudReady: Boolean(result.ok) })
        util.toast(result.ok ? '资料已保存并同步' : '资料已保存到本机', result.ok ? 'success' : 'none')
      })
      .catch(() => {
        this.setData({ authorizing: false, profile, profileFormReady: true, showProfileEditor: false })
        util.toast('资料已保存到本机')
      })
  },

  goIslands() {
    wx.navigateTo({ url: '/pages/islands/islands' })
  },

  goPhotos() {
    wx.navigateTo({ url: '/pages/photo-gallery/photo-gallery' })
  },

  goTour() {
    wx.navigateTo({ url: '/pages/tour/tour' })
  },

  async onLogout() {
    const ok = await util.confirm('退出登录', '将清除本机头像、昵称、小岛、标点、照片和搜索历史。云端备份会保留，重新登录后恢复。')
    if (!ok) return
    this.setData({ authorizing: true })
    wx.showLoading({ title: '正在退出', mask: true })
    const [dataResult, profileResult, notesResult] = await Promise.all([
      cloud.syncAll(),
      cloud.syncProfile(storage.getProfile()),
      cloud.syncNotes(storage.getNotes())
    ]).catch(() => [{ ok: false }, { ok: false }, { ok: false }])
    wx.hideLoading()
    const synced = Boolean(dataResult && dataResult.ok && profileResult && profileResult.ok && notesResult && notesResult.ok)
    if (!synced) {
      const continueLogout = await util.confirm('同步失败', '继续退出会清除本机缓存，未备份的最新数据将无法恢复。仍要退出吗？')
      if (!continueLogout) {
        this.setData({ authorizing: false })
        return
      }
    }
    this.profileRequestId = (this.profileRequestId || 0) + 1
    storage.clearAccountData()
    getApp().logout()
    this.setData({
      profile: null,
      cloudReady: false,
      authorizing: false,
      profileFormReady: false,
      showProfileEditor: false,
      avatarError: false,
      draftNickName: '',
      draftAvatarUrl: ''
    })
    util.toast(synced ? '已退出登录' : '已退出，本机缓存已清除')
  }
})
