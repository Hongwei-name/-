const storage = require('../../utils/storage')
const util = require('../../utils/util')

Page({
  data: {
    place: null
  },

  onLoad() {
    const place = getApp().globalData.pendingPlace
    getApp().globalData.pendingPlace = null
    if (!place) {
      util.toast('景点信息已失效')
      setTimeout(() => wx.navigateBack(), 400)
      return
    }
    const photoUrls = Array.isArray(place.photoUrls) && place.photoUrls.length
      ? place.photoUrls
      : (place.photoUrl ? [place.photoUrl] : [])
    this.setData({
      place: Object.assign({}, place, {
        ratingText: place.rating === null || place.rating === undefined ? '' : '评分 ' + Number(place.rating).toFixed(1),
        photoUrls,
        mainPhotoUrl: photoUrls[0] || ''
      })
    })
  },

  onBack() {
    wx.navigateBack()
  },

  onPreviewPhoto(e) {
    const current = e.currentTarget.dataset.url
    const place = this.data.place
    if (!current || !place) return
    wx.previewImage({ current, urls: place.photoUrls || [] })
  },

  onMark() {
    const place = this.data.place
    if (!place) return
    if (!storage.isLoggedIn()) {
      util.toast('请先登录后再标记小岛')
      wx.switchTab({ url: '/pages/profile/profile' })
      return
    }
    const query = [
      'lng=' + place.lng,
      'lat=' + place.lat,
      'name=' + encodeURIComponent(place.name || ''),
      'address=' + encodeURIComponent(place.address || '')
    ].join('&')
    wx.navigateTo({ url: '/pages/mark-edit/mark-edit?' + query })
  },

  onRoute() {
    const place = this.data.place
    if (!place) return
    getApp().globalData.pendingRouteEnd = {
      lng: place.lng,
      lat: place.lat,
      name: place.name,
      address: place.address
    }
    wx.navigateTo({ url: '/pages/route/route' })
  }
})
