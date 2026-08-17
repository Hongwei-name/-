/**
 * 自定义 tabBar（使用 iconfont 字体图标）
 * 页面在 onShow 中调用 this.getTabBar().setData({ selected: n }) 更新选中态
 */
Component({
  data: {
    selected: 0,
    visible: true,
    list: [
      { path: '/pages/index/index', text: '地图', icon: 'icon-map' },
      { path: '/pages/note/note', text: '随心记', icon: 'icon-info' },
      { path: '/pages/profile/profile', text: '我的', type: 'profile' }
    ]
  },

  methods: {
    onTap(e) {
      const index = e.currentTarget.dataset.index
      const path = e.currentTarget.dataset.path
      if (index === this.data.selected) return
      wx.switchTab({ url: path })
    }
  }
})
