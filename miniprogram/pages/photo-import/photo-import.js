/**
 * 照片导入归集页
 *  - 模式 A（无 islandId）：选择照片 -> EXIF 解析 -> 自动匹配已标记小岛
 *    -> 结果列表可手动调整归属 -> 确认保存
 *  - 模式 B（有 islandId）：选择照片 -> 直接归集到指定小岛（不依赖 EXIF）
 */
const photo = require('../../utils/photo')
const storage = require('../../utils/storage')
const util = require('../../utils/util')

Page({
  data: {
    fixedIsland: null,     // 模式 B 的目标小岛
    islands: [],
    islandNames: ['不归集'],
    results: [],
    analyzing: false,
    saving: false,
    matchedCount: 0,
    saveCount: 0
  },

  onLoad(options) {
    if (!storage.isLoggedIn()) {
      util.toast('请先登录后再归集照片')
      setTimeout(() => wx.switchTab({ url: '/pages/profile/profile' }), 500)
      return
    }
    const islands = storage.getIslands()
    const islandNames = ['不归集'].concat(islands.map((i) => i.name))
    this.setData({
      islands,
      islandNames,
      fixedIsland: options.islandId ? storage.getIsland(options.islandId) : null
    })

    // 模式 B：立即引导选照片
    if (options.islandId && !this.data.fixedIsland) {
      util.toast('小岛不存在')
      setTimeout(() => wx.navigateBack(), 600)
    }
  },

  onBack() {
    wx.navigateBack()
  },

  onChoose() {
    if (this.data.analyzing || this.data.saving) return
    if (this.data.fixedIsland) {
      // 模式 B：直接归集到指定小岛
      this.setData({ analyzing: true })
      wx.showLoading({ title: '保存中', mask: true })
      photo
        .importPhotosToIsland(this.data.fixedIsland.id)
        .then((list) => {
          wx.hideLoading()
          this.setData({ analyzing: false })
          if (!list.length) return
          util.toast('已添加 ' + list.length + ' 张照片')
          setTimeout(() => wx.navigateBack(), 500)
        })
        .catch((err) => {
          wx.hideLoading()
          this.setData({ analyzing: false })
          if (err && /cancel/i.test(err.errMsg || '')) return
          util.toast('添加失败：' + (err.message || '请检查相册权限'))
        })
      return
    }

    // 模式 A：解析 + 自动匹配
    this.setData({ analyzing: true })
    photo
      .importPhotosWithMatch(9)
      .then((results) => {
        const enriched = results.map((r) => {
          let status = 'unmatched'
          let distText = ''
          if (!r.hasGps) {
            status = 'no-gps'
          } else if (r.matchedIsland) {
            status = 'matched'
          } else {
            distText = r.distM !== null ? '（附近 ' + util.formatDistance(r.distM) + ' 内无小岛）' : ''
          }
          // pickIndex 默认指向自动匹配的小岛
          const pickIndex = r.matchedIsland
            ? this.data.islands.findIndex((i) => i.id === r.matchedIsland.id) + 1
            : 0
          return Object.assign({}, r, {
            status,
            distText,
            pickIndex,
            islandName: pickIndex > 0 ? this.data.islandNames[pickIndex] : '',
            shotTimeText: r.shotTime ? util.formatTime(r.shotTime) : ''
          })
        })
        this.setData({
          results: enriched,
          analyzing: false,
          matchedCount: enriched.filter((r) => r.status === 'matched').length
        })
        this.recalcSaveCount()
      })
      .catch((err) => {
        this.setData({ analyzing: false })
        if (err && /cancel/i.test(err.errMsg || '')) return
        util.toast('读取相册失败，请检查相册权限')
      })
  },

  /** 手动调整归属 */
  onPickChange(e) {
    const idx = e.currentTarget.dataset.index
    const val = Number(e.detail.value)
    const key = 'results[' + idx + '].pickIndex'
    const keyName = 'results[' + idx + '].islandName'
    this.setData({
      [key]: val,
      [keyName]: val > 0 ? this.data.islandNames[val] : ''
    }, () => this.recalcSaveCount())
  },

  recalcSaveCount() {
    const saveCount = this.data.results.filter((r) => r.pickIndex > 0).length
    this.setData({ saveCount })
  },

  onSave() {
    if (this.data.saving || this.saving) return
    if (!this.data.saveCount) {
      util.toast('请先为照片选择归属小岛')
      return
    }
    const payload = this.data.results.map((r) =>
      Object.assign({}, r, {
        islandId: r.pickIndex > 0 ? this.data.islands[r.pickIndex - 1].id : ''
      })
    )
    this.saving = true
    this.setData({ saving: true })
    try {
      photo.commitPhotos(payload)
      util.toast('已保存 ' + this.data.saveCount + ' 张照片')
      setTimeout(() => wx.navigateBack(), 600)
    } catch (err) {
      this.saving = false
      this.setData({ saving: false })
      util.toast('保存失败，请稍后重试')
    }
  }
})
