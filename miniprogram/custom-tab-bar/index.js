/**
 * 自定义 tabBar（使用图片图标）
 * 页面在 onShow 中调用 this.getTabBar().setData({ selected: n }) 更新选中态
 */
Component({
  data: {
    selected: 0,
    visible: true,
    list: [
      { path: '/pages/index/index', text: '地图', iconPath: '/images/tabbar/map.png' },
      { path: '/pages/note/note', text: '随心记', iconPath: '/images/tabbar/note.png' },
      { path: '/pages/profile/profile', text: '我的', iconPath: '/images/tabbar/profile.png' }
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
