const storage = require('../../utils/storage')
const cloud = require('../../utils/cloud')
const util = require('../../utils/util')

function mergeNotes(local, remote) {
  const map = {}
  ;(local || []).forEach((note) => { map[note.id] = note })
  ;(remote || []).forEach((note) => {
    const current = map[note.id]
    if (!current || (note.updatedAt || 0) > (current.updatedAt || 0)) map[note.id] = note
  })
  return Object.keys(map).map((id) => map[id]).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

Page({
  data: {
    loggedIn: false,
    content: '',
    notes: [],
    saving: false
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) tabBar.setData({ selected: 1, visible: true })
    this.refresh()
  },

  refresh() {
    const loggedIn = storage.isLoggedIn()
    this.setData({ loggedIn, notes: loggedIn ? this.formatNotes(storage.getNotes()) : [] })
    if (!loggedIn) return
    cloud.pullNotes().then((remoteNotes) => {
      const notes = mergeNotes(storage.getNotes(), remoteNotes)
      storage.replaceNotes(notes)
      this.setData({ notes: this.formatNotes(notes) })
      if (notes.length && !remoteNotes.length) cloud.syncNotes(notes)
    }).catch(() => {})
  },

  formatNotes(notes) {
    return (notes || []).map((note) => Object.assign({}, note, { timeText: util.formatTime(note.createdAt) }))
  },

  onInput(e) {
    this.setData({ content: e.detail.value })
  },

  onSave() {
    if (!this.data.loggedIn) {
      wx.switchTab({ url: '/pages/profile/profile' })
      return
    }
    if (this.data.saving) return
    const content = (this.data.content || '').trim()
    if (!content) {
      util.toast('写点此刻的感受')
      return
    }
    const note = storage.saveNote(content)
    if (!note) return
    this.setData({ content: '', notes: this.formatNotes(storage.getNotes()), saving: true })
    cloud.syncNotes(storage.getNotes()).then((result) => {
      this.setData({ saving: false })
      util.toast(result.ok ? '已记录' : '已记录到本机', result.ok ? 'success' : 'none')
    }).catch(() => {
      this.setData({ saving: false })
      util.toast('已记录到本机')
    })
  },

  async onDelete(e) {
    const id = e.currentTarget.dataset.id
    const ok = await util.confirm('删除随心记', '确定删除这条记录吗？')
    if (!ok) return
    storage.deleteNote(id)
    this.setData({ notes: this.formatNotes(storage.getNotes()) })
    cloud.syncNotes(storage.getNotes())
  },

  goLogin() {
    wx.switchTab({ url: '/pages/profile/profile' })
  }
})
