/**
 * 我的小岛列表
 *  - 展示全部已标记小岛：名称 / 地址 / 照片数 / 标记时间 / 距离
 *  - 支持按标记时间（新→旧）与距当前位置远近排序
 *  - 点击进入详情，支持编辑 / 删除
 */
const storage = require('../../utils/storage')
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')
const { sortByDistance } = require('../../utils/distance')

Page({
  data: {
    sortMode: 'time', // time | distance
    islands: [],
    cloudReady: false,
    syncing: false
  },

  onLoad() {
    this.offStorage = storage.onChange(() => this.refresh())
  },

  onShow() {
    this.setData({ cloudReady: getApp().globalData.cloudReady })
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  onUnload() {
    if (this.offStorage) this.offStorage()
  },

  refresh() {
    const app = getApp()
    let islands = storage.getIslands().map((isl) => {
      const photos = storage.getPhotosByIsland(isl.id)
      return Object.assign({}, isl, {
        photoCount: photos.length,
        visitedText: isl.visited ? '已去过' : '',
        createdAtText: util.formatTime(isl.createdAt)
      })
    })

    if (this.data.sortMode === 'distance') {
      const loc = app.globalData.location
      if (loc) {
        islands = sortByDistance(islands, loc.lng, loc.lat).map((i) =>
          Object.assign({}, i, { distanceText: '距当前位置 ' + util.formatDistance(i.distance) })
        )
      } else {
        util.toast('未获取到定位，暂按时间排序')
      }
    } else {
      islands = islands.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    }

    this.setData({ islands })
  },

  onSortChange(e) {
    const mode = e.currentTarget.dataset.mode
    this.setData({ sortMode: mode })
    this.refresh()
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/island-detail/island-detail?id=' + id })
  },

  onEdit(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/mark-edit/mark-edit?id=' + id })
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id
    const island = storage.getIsland(id)
    if (!island) return
    util.confirm('删除小岛', '确定删除「' + island.name + '」吗？其下归集的照片关联也会一并解除（原图不会被删除）。').then((ok) => {
      if (!ok) return
      storage.deleteIsland(id)
      util.toast('已删除')
      this.refresh()
    })
  },

  /** 手动触发云端同步备份 */
  onSyncTap() {
    if (this.data.syncing) return
    if (!cloud.isAvailable()) {
      util.toast('云开发未开通，数据仅保存在本地')
      return
    }
    this.setData({ syncing: true })
    cloud
      .syncAll()
      .then((res) => {
        this.setData({ syncing: false })
        if (res.ok) {
          util.toast('云端备份完成', 'success')
        } else {
          util.toast('同步失败：' + (res.reason === 'not-logged-in' ? '未登录' : '网络异常'))
        }
      })
  },

  goPhotoImport() {
    wx.navigateTo({ url: '/pages/photo-import/photo-import' })
  },

  goMap() {
    wx.switchTab({ url: '/pages/index/index' })
  },

  onBack() {
    wx.navigateBack()
  }
})
