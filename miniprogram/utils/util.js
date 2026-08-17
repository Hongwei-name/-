/**
 * 通用工具
 */

/** 生成唯一 id（本地自增式，前缀 + 时间戳 + 随机数） */
function genId(prefix) {
  const p = prefix || 'id'
  return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** 时间戳 -> 'YYYY-MM-DD HH:mm' */
function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n) => (n < 10 ? '0' + n : '' + n)
  return (
    d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  )
}

/** 时间戳 -> 'YYYY-MM-DD' */
function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n) => (n < 10 ? '0' + n : '' + n)
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/** 秒 -> 'X小时X分钟' / 'X分钟' */
function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return ''
  const min = Math.round(seconds / 60)
  if (min < 60) return min + '分钟'
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? h + '小时' + m + '分钟' : h + '小时'
}

/** 米 -> 'X.X公里' / 'X米' */
function formatDistance(meters) {
  if (!meters && meters !== 0) return ''
  if (meters < 1000) return Math.round(meters) + '米'
  return (meters / 1000).toFixed(1) + '公里'
}

/** 防抖 */
function debounce(fn, wait) {
  let timer = null
  return function (...args) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn.apply(this, args)
    }, wait)
  }
}

/** 简易 Promise 化 wx API */
function promisify(fn) {
  return (options = {}) =>
    new Promise((resolve, reject) => {
      fn(
        Object.assign({}, options, {
          success: resolve,
          fail: reject
        })
      )
    })
}

/** toast 快捷封装 */
function toast(title, icon) {
  wx.showToast({ title, icon: icon || 'none' })
}

/** 确认框 */
function confirm(title, content) {
  return new Promise((resolve) => {
    wx.showModal({
      title: title || '提示',
      content: content || '',
      confirmColor: '#2B5CD9',
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false)
    })
  })
}

module.exports = {
  genId,
  formatTime,
  formatDate,
  formatDuration,
  formatDistance,
  debounce,
  promisify,
  toast,
  confirm
}
