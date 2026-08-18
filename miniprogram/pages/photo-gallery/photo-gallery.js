const storage = require('../../utils/storage')
const util = require('../../utils/util')

Page({
  data: {
    photos: [],
    photoCount: 0
  },

  onLoad() {
    if (!storage.isLoggedIn()) {
      util.toast('请先登录后查看照片')
      setTimeout(() => wx.switchTab({ url: '/pages/profile/profile' }), 400)
      return
    }
    this.offStorage = storage.onChange(() => this.refresh())
  },

  onShow() {
    this.refresh()
  },

  onUnload() {
    if (this.offStorage) this.offStorage()
  },

  refresh() {
    const photos = storage.getPhotos()
      .slice()
      .sort((a, b) => (b.shotTime || b.createdAt || 0) - (a.shotTime || a.createdAt || 0))
      .map((photo) => {
        const island = storage.getIsland(photo.islandId)
        return Object.assign({}, photo, {
          islandName: island ? island.name : '未归属小岛',
          timeText: util.formatTime(photo.shotTime || photo.createdAt)
        })
      })
    this.setData({ photos, photoCount: photos.length })
  },

  onAddPhotos() {
    wx.navigateTo({ url: '/pages/photo-import/photo-import' })
  },

  onPreview(e) {
    const index = Number(e.currentTarget.dataset.index)
    const current = this.data.photos[index]
    if (!current || current.imageUnavailable || !current.localPath) return
    const urls = this.data.photos
      .filter((photo) => photo.localPath && !photo.imageUnavailable)
      .map((photo) => photo.localPath)
    if (!urls.length) return
    wx.previewImage({ current: current.localPath, urls })
  },

  onImageError(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isInteger(index) || !this.data.photos[index]) return
    this.setData({ ['photos[' + index + '].imageUnavailable']: true })
  },

  onOpenIsland(e) {
    const id = e.currentTarget.dataset.id
    if (id && storage.getIsland(id)) {
      wx.navigateTo({ url: '/pages/island-detail/island-detail?id=' + id })
    }
  },

  async onRemove(e) {
    const index = Number(e.currentTarget.dataset.index)
    const photo = this.data.photos[index]
    if (!photo) return
    const ok = await util.confirm('移除照片', '移除这张照片的归集关联吗？原图不会被删除。')
    if (!ok) return
    storage.removePhoto(photo.id)
    util.toast('已移除')
  },

  onBack() {
    wx.navigateBack()
  }
})
