Component({
  properties: {
    title: { type: String, value: '' },
    showBack: { type: Boolean, value: false },
    largeInset: { type: Boolean, value: false },
    searchMode: { type: Boolean, value: false },
    keyword: { type: String, value: '' },
    placeholder: { type: String, value: '搜索' }
  },

  data: {
    statusBarHeight: 20,
    navHeight: 64,
    menuRight: 24
  },

  lifetimes: {
    attached() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const statusBarHeight = info.statusBarHeight || 20
      const menuButton = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect()
      // 胶囊下方保留呼吸区，避免标题与页面内容贴得过紧。
      const navHeight = menuButton
        ? menuButton.bottom + (menuButton.top - statusBarHeight) + 16
        : statusBarHeight + 60
      const menuRight = menuButton ? Math.max(24, info.windowWidth - menuButton.left + 12) : 24
      this.setData({ statusBarHeight, navHeight, menuRight })
    }
  },

  methods: {
    onBack() {
      this.triggerEvent('back')
    },

    onSearchInput(e) {
      this.triggerEvent('searchinput', { value: e.detail.value })
    },

    onSearchConfirm() {
      this.triggerEvent('searchconfirm')
    },

    onSearchClear() {
      this.triggerEvent('searchclear')
    }
  }
})
