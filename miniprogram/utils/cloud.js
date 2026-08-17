/**
 * 云同步封装（微信云开发）
 *
 * 策略：本地数据为操作主源（未登录也可全功能使用），登录后全量同步云端备份。
 *  - 上传：将本地小岛 / 照片关联 / 删除记录推送到云函数，按 localId upsert
 *  - 拉取：拉取云端全部记录，与本地按 updatedAt 较新者胜合并
 *  - 照片只传元数据（路径字符串 + EXIF 经纬度 + 关联 ID），不传图片本身
 */
const config = require('../config/index')
const storage = require('./storage')

const app = () => getApp()
let syncPromise = null

/** 等待登录完成 */
function ensureLogin() {
  return app().ensureLogin()
}

/** 按 updatedAt 合并两列表（新者胜） */
function mergeByUpdatedAt(localList, remoteList) {
  const map = {}
  ;(localList || []).forEach((item) => {
    map[item.id] = item
  })
  ;(remoteList || []).forEach((item) => {
    const cur = map[item.id]
    if (!cur || (item.updatedAt || 0) > (cur.updatedAt || 0)) {
      map[item.id] = item
    }
  })
  return Object.keys(map).map((k) => map[k])
}

/** 云函数以 localId 存储业务主键，拉取后统一还原成本地的 id 字段。 */
function normalizeRemoteList(list) {
  return (list || [])
    .map((item) => {
      const id = item && (item.id || item.localId)
      return id ? Object.assign({}, item, { id }) : null
    })
    .filter(Boolean)
}

/** 调用云函数（带错误兜底） */
function callFn(name, data) {
  return wx.cloud
    .callFunction({ name: name, data: data || {} })
    .then((res) => res.result || {})
}

/**
 * 执行一次全量同步
 * @returns Promise<{ok: boolean, reason?: string}>
 */
function syncAll() {
  if (syncPromise) return syncPromise

  syncPromise = ensureLogin().then((openid) => {
    if (!openid) {
      return { ok: false, reason: 'not-logged-in' }
    }
    return pushAll()
      .then(() => pullAndMerge())
      .then(() => ({ ok: true }))
      .catch((err) => {
        console.warn('[sync] 同步失败', err)
        return { ok: false, reason: (err && err.message) || 'sync-failed' }
      })
  })
  return syncPromise.then(
    (result) => {
      syncPromise = null
      return result
    },
    (err) => {
      syncPromise = null
      throw err
    }
  )
}

/** 上传本地全部数据 + 删除记录 */
function pushAll() {
  const islands = storage.getIslands()
  const photos = storage.getPhotos()
  const deleted = storage.takeDeleted()

  const pushIslands = callFn(config.CLOUD_FN.SYNC_ISLANDS, {
    op: 'push',
    islands: islands,
    deleted: deleted.islands
  })
  const pushPhotos = callFn(config.CLOUD_FN.SYNC_PHOTOS, {
    op: 'push',
    photos: photos,
    deleted: deleted.photos
  })
  return Promise.all([pushIslands, pushPhotos]).catch((err) => {
    // 失败则回写删除记录，避免丢失
    storage.putBackDeleted(deleted)
    throw err
  })
}

/** 拉取云端数据并与本地合并 */
function pullAndMerge() {
  return Promise.all([
    callFn(config.CLOUD_FN.SYNC_ISLANDS, { op: 'pull' }),
    callFn(config.CLOUD_FN.SYNC_PHOTOS, { op: 'pull' })
  ]).then(([rIslands, rPhotos]) => {
    const mergedIslands = mergeByUpdatedAt(storage.getIslands(), normalizeRemoteList(rIslands.islands))
    const mergedPhotos = mergeByUpdatedAt(storage.getPhotos(), normalizeRemoteList(rPhotos.photos))
    storage.replaceAll(mergedIslands, mergedPhotos)
  })
}

/** 同步当前是否可用 */
function isAvailable() {
  return app().globalData.cloudReady
}

module.exports = {
  syncAll,
  isAvailable,
  ensureLogin,
  callFn,
  mergeByUpdatedAt,
  normalizeRemoteList
}
