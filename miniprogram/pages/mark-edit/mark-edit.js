/**
 * 小岛标记编辑页
 *  - 新建：从地图点击点 / 搜索结果带入坐标与名称
 *  - 编辑：修改名称、地址、备注
 */
const storage = require('../../utils/storage')
const util = require('../../utils/util')

Page({
  data: {
    isEdit: false,
    islandId: '',
    form: {
      name: '',
      address: '',
      remark: '',
      lng: null,
      lat: null
    }
  },

  onLoad(options) {
    if (!storage.isLoggedIn()) {
      util.toast('请先登录后再标记小岛')
      setTimeout(() => wx.switchTab({ url: '/pages/profile/profile' }), 500)
      return
    }
    if (options.id) {
      // 编辑模式
      const island = storage.getIsland(options.id)
      if (!island) {
        util.toast('小岛不存在')
        setTimeout(() => wx.navigateBack(), 500)
        return
      }
      this.setData({
        isEdit: true,
        islandId: island.id,
        form: {
          name: island.name,
          address: island.address,
          remark: island.remark,
          lng: island.lng,
          lat: island.lat
        }
      })
    } else {
      // 新建模式：必须有坐标
      const lng = parseFloat(options.lng)
      const lat = parseFloat(options.lat)
      if (isNaN(lng) || isNaN(lat)) {
        util.toast('缺少坐标信息')
        setTimeout(() => wx.navigateBack(), 500)
        return
      }
      this.setData({
        form: {
          name: decodeURIComponent(options.name || ''),
          address: decodeURIComponent(options.address || ''),
          remark: '',
          lng: lng,
          lat: lat
        }
      })
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },

  onBack() {
    wx.navigateBack()
  },

  onSave() {
    if (!storage.isLoggedIn()) {
      util.toast('登录已失效，请重新登录')
      return
    }
    const form = this.data.form
    if (!form.name.trim()) {
      util.toast('请填写小岛名称')
      return
    }
    if (form.lng === null || form.lat === null) {
      util.toast('缺少坐标信息')
      return
    }

    if (this.data.isEdit) {
      storage.updateIsland(this.data.islandId, {
        name: form.name.trim(),
        address: form.address.trim(),
        remark: form.remark.trim()
      })
      util.toast('已保存')
    } else {
      storage.saveIsland({
        name: form.name.trim(),
        address: form.address.trim(),
        remark: form.remark.trim(),
        lng: form.lng,
        lat: form.lat
      })
      util.toast('已标记为我的小岛')
    }
    setTimeout(() => wx.navigateBack(), 500)
  }
})
