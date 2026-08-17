/**
 * 小岛详情页
 *  - 地点基础信息（名称 / 地址 / 坐标 / 备注 / 标记时间）
 *  - 归集照片墙：点击预览，长按移除归集（不删除原图）
 *  - 操作：编辑、删除、以此地为终点的路线规划、添加照片
 */
const storage = require('../../utils/storage')
const util = require('../../utils/util')

Page({
  data: {
    islandId: '',
    island: null,
    photos: []
  },

  onLoad(options) {
    this.setData({ islandId: options.id || '' })
    this.offStorage = storage.onChange(() => this.refresh())
    this.refresh()
  },

  onUnload() {
    if (this.offStorage) this.offStorage()
  },

  refresh() {
    const island = storage.getIsland(this.data.islandId)
    if (!island) {
      this.setData({ island: null, photos: [] })
      return
    }
    const photos = storage.getPhotosByIsland(island.id)
    this.setData({
      island: Object.assign({}, island, {
        createdAtText: util.formatTime(island.createdAt)
      }),
      photos
    })
  },

  onEdit() {
    wx.navigateTo({ url: '/pages/mark-edit/mark-edit?id=' + this.data.islandId })
  },

  onBack() {
    wx.navigateBack()
  },

  /** 以本小岛为终点发起路线规划 */
  onRoute() {
    wx.navigateTo({ url: '/pages/route/route?endId=' + this.data.islandId })
  },

  /** 添加照片（含自动归集 / 手动添加） */
  onAddPhotos() {
    wx.navigateTo({ url: '/pages/photo-import/photo-import?islandId=' + this.data.islandId })
  },

  /** 点击照片 -> 全屏预览 */
  onPreview(e) {
    const idx = e.currentTarget.dataset.index
    const photos = this.data.photos
    if (!photos[idx]) return
    wx.previewImage({
      current: photos[idx].localPath,
      urls: photos.map((p) => p.localPath)
    })
  },

  /** 长按照片 -> 移除归集 */
  async onRemovePhoto(e) {
    const idx = e.currentTarget.dataset.index
    const photo = this.data.photos[idx]
    if (!photo) return
    const ok = await util.confirm('移除照片', '移除这张照片的归集关联吗？原图不会被删除，之后仍可重新归集。')
    if (!ok) return
    storage.removePhoto(photo.id)
    util.toast('已移除')
    this.refresh()
  },

  async onDelete() {
    const island = this.data.island
    if (!island) return
    const ok = await util.confirm('删除小岛', '确定删除「' + island.name + '」吗？其下归集的照片关联也会一并解除（原图不会被删除）。')
    if (!ok) return
    storage.deleteIsland(island.id)
    util.toast('已删除')
    setTimeout(() => wx.navigateBack(), 400)
  }
})
