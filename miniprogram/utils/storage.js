/**
 * 本地数据层（小程序的 Storage）
 *
 * 数据模型：
 *  - island（小岛/标记景点）：{ id, name, address, lng, lat, remark, createdAt, updatedAt }
 *  - photo（照片关联）：{ id, islandId, localPath, exifLng, exifLat, shotTime, locationName, createdAt, updatedAt }
 *  - history（搜索历史）：[{ keyword, time }]
 *  - notes（随心记）：[{ id, content, createdAt, updatedAt }]
 *  - profile（本地用户资料）：{ nickName, avatarUrl, updatedAt }
 *  - deleted（待同步删除）：{ islands: [{id, updatedAt}], photos: [...] }
 *
 * 约束：不存储原图到服务端，仅保存图片本地路径 + EXIF 经纬度 + 关联小岛 ID。
 * 所有数据按当前 OpenID 分区；未登录时不读取也不写入旅行数据。
 */
const util = require('./util')

const KEYS = {
  ISLANDS: 'xy:islands',
  PHOTOS: 'xy:photos',
  HISTORY: 'xy:history',
  NOTES: 'xy:notes',
  DELETED: 'xy:deleted',
  PROFILE: 'xy:profile'
}

const LEGACY_MIGRATION_KEY = 'xy:account-data-migrated'

const listeners = []

function readRaw(key, fallback) {
  try {
    const val = wx.getStorageSync(key)
    return val === '' || val === null || val === undefined ? fallback : val
  } catch (e) {
    return fallback
  }
}

function writeRaw(key, val) {
  try {
    wx.setStorageSync(key, val)
  } catch (e) {
    console.warn('[storage] 写入失败', key, e)
  }
}

function isSameData(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch (e) {
    return false
  }
}

function removeRaw(key) {
  try {
    wx.removeStorageSync(key)
  } catch (e) {}
}

function getOpenid() {
  try {
    const app = typeof getApp === 'function' && getApp()
    return (app && app.globalData && app.globalData.openid) || ''
  } catch (e) {
    return ''
  }
}

function scopedKey(key) {
  const openid = getOpenid()
  return openid ? key + ':' + openid : ''
}

function isLoggedIn() {
  return Boolean(scopedKey(KEYS.ISLANDS))
}

function read(key, fallback) {
  const keyForAccount = scopedKey(key)
  return keyForAccount ? readRaw(keyForAccount, fallback) : fallback
}

function write(key, val) {
  const keyForAccount = scopedKey(key)
  if (!keyForAccount) return false
  writeRaw(keyForAccount, val)
  return true
}

function remove(key) {
  const keyForAccount = scopedKey(key)
  if (!keyForAccount) return false
  removeRaw(keyForAccount)
  return true
}

function emit() {
  listeners.forEach((cb) => {
    try {
      cb()
    } catch (e) {
      console.warn('[storage] 监听回调异常', e)
    }
  })
}

/** 订阅数据变更，返回取消函数 */
function onChange(cb) {
  listeners.push(cb)
  return () => {
    const idx = listeners.indexOf(cb)
    if (idx > -1) listeners.splice(idx, 1)
  }
}

/* ---------------- 小岛 ---------------- */

function getIslands() {
  return read(KEYS.ISLANDS, [])
}

function getIsland(id) {
  return getIslands().find((i) => i.id === id) || null
}

/** 新增小岛（自动补 id / createdAt / updatedAt） */
function saveIsland(data) {
  const now = Date.now()
  const island = Object.assign(
    {
      id: util.genId('isl'),
      name: '',
      address: '',
      lng: null,
      lat: null,
      remark: '',
      visited: false,
      visitedAt: null,
      arrivedAt: null,
      createdAt: now,
      updatedAt: now
    },
    data,
    { updatedAt: now }
  )
  if (!island.createdAt) island.createdAt = now
  const list = getIslands()
  list.push(island)
  write(KEYS.ISLANDS, list)
  emit()
  return island
}

/** 更新小岛（部分字段） */
function updateIsland(id, patch) {
  const list = getIslands()
  const idx = list.findIndex((i) => i.id === id)
  if (idx === -1) return null
  list[idx] = Object.assign({}, list[idx], patch, { updatedAt: Date.now() })
  write(KEYS.ISLANDS, list)
  emit()
  return list[idx]
}

/** 删除小岛：同时解除其下照片关联（照片记录一并移除，原图不动） */
function deleteIsland(id) {
  let list = getIslands()
  const target = list.find((i) => i.id === id)
  list = list.filter((i) => i.id !== id)
  write(KEYS.ISLANDS, list)

  // 其下照片解除关联
  const photos = getPhotos()
  const removedPhotos = photos.filter((p) => p.islandId === id)
  write(KEYS.PHOTOS, photos.filter((p) => p.islandId !== id))

  // 记录待同步删除
  const deleted = read(KEYS.DELETED, { islands: [], photos: [] })
  if (target) {
    deleted.islands.push({ id: id, updatedAt: Date.now() })
  }
  removedPhotos.forEach((p) => deleted.photos.push({ id: p.id, updatedAt: Date.now() }))
  write(KEYS.DELETED, deleted)
  emit()
}

/* ---------------- 照片 ---------------- */

function getPhotos() {
  return read(KEYS.PHOTOS, [])
}

function getPhotosByIsland(islandId) {
  return getPhotos().filter((p) => p.islandId === islandId)
}

/** 新增照片关联记录 */
function addPhoto(data) {
  const now = Date.now()
  const photo = Object.assign(
    {
      id: util.genId('pho'),
      islandId: '',
      localPath: '',
      exifLng: null,
      exifLat: null,
      shotTime: null,
      locationName: '',
      createdAt: now,
      updatedAt: now
    },
    data
  )
  const list = getPhotos()
  list.push(photo)
  write(KEYS.PHOTOS, list)
  emit()
  return photo
}

/** 更新照片关联（如手动改归属 islandId） */
function updatePhoto(id, patch) {
  const list = getPhotos()
  const idx = list.findIndex((p) => p.id === id)
  if (idx === -1) return null
  list[idx] = Object.assign({}, list[idx], patch, { updatedAt: Date.now() })
  write(KEYS.PHOTOS, list)
  emit()
  return list[idx]
}

/** 移除照片归集（仅解除关联，不删除原图） */
function removePhoto(id) {
  const list = getPhotos()
  const target = list.find((p) => p.id === id)
  write(KEYS.PHOTOS, list.filter((p) => p.id !== id))
  if (target) {
    const deleted = read(KEYS.DELETED, { islands: [], photos: [] })
    deleted.photos.push({ id: id, updatedAt: Date.now() })
    write(KEYS.DELETED, deleted)
  }
  emit()
}

/* ---------------- 搜索历史 ---------------- */

function getHistory() {
  return read(KEYS.HISTORY, [])
}

function addHistory(keyword) {
  const kw = (keyword || '').trim()
  if (!kw) return
  let list = getHistory().filter((h) => h.keyword !== kw)
  list.unshift({ keyword: kw, time: Date.now() })
  list = list.slice(0, 20)
  write(KEYS.HISTORY, list)
}

function clearHistory() {
  write(KEYS.HISTORY, [])
}

/* ---------------- 随心记 ---------------- */

function getNotes() {
  return read(KEYS.NOTES, []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

function saveNote(content) {
  const text = String(content || '').trim()
  if (!text) return null
  const now = Date.now()
  const note = {
    id: util.genId('note'),
    content: text.slice(0, 500),
    createdAt: now,
    updatedAt: now
  }
  const notes = getNotes()
  notes.unshift(note)
  write(KEYS.NOTES, notes)
  emit()
  return note
}

function deleteNote(id) {
  const notes = getNotes().filter((note) => note.id !== id)
  write(KEYS.NOTES, notes)
  emit()
}

function replaceNotes(notes) {
  const next = Array.isArray(notes) ? notes : []
  if (isSameData(getNotes(), next)) return false
  write(KEYS.NOTES, next)
  emit()
  return true
}

/* ---------------- 用户资料 ---------------- */

function getProfile() {
  return read(KEYS.PROFILE, null)
}

function saveProfile(profile) {
  const value = Object.assign(
    {
      nickName: '',
      avatarUrl: '',
      updatedAt: Date.now()
    },
    profile,
    { updatedAt: Date.now() }
  )
  write(KEYS.PROFILE, value)
  return value
}

/** 使用云端资料覆盖本地缓存，保留云端的更新时间用于后续冲突比较。 */
function replaceProfile(profile) {
  if (!profile) return null
  const value = {
    nickName: profile.nickName || '',
    avatarUrl: profile.avatarUrl || '',
    updatedAt: profile.updatedAt || Date.now()
  }
  write(KEYS.PROFILE, value)
  return value
}

function clearProfile() {
  remove(KEYS.PROFILE)
}

/**
 * 将旧版本未分区的本地数据迁移到首次登录的账号下，并删除旧副本。
 * 迁移只会执行一次，避免其他账号读取到原先设备级的数据。
 */
function migrateLegacyData() {
  if (!isLoggedIn() || readRaw(LEGACY_MIGRATION_KEY, false)) return false

  Object.keys(KEYS).forEach((name) => {
    const key = KEYS[name]
    const legacy = readRaw(key, undefined)
    const keyForAccount = scopedKey(key)
    if (legacy !== undefined && readRaw(keyForAccount, undefined) === undefined) {
      writeRaw(keyForAccount, legacy)
    }
    removeRaw(key)
  })
  writeRaw(LEGACY_MIGRATION_KEY, true)
  emit()
  return true
}

/** 退出账号时删除该账号在本机的全部缓存，云端备份不受影响。 */
function clearAccountData() {
  if (!isLoggedIn()) return
  const profile = getProfile()
  Object.keys(KEYS).forEach((name) => remove(KEYS[name]))
  if (profile && profile.avatarUrl && /^wxfile:\/\//.test(profile.avatarUrl)) {
    try {
      wx.removeSavedFile({ filePath: profile.avatarUrl })
    } catch (e) {}
  }
  emit()
}

/* ---------------- 同步辅助 ---------------- */

/** 取待同步删除记录（取后清空） */
function takeDeleted() {
  const deleted = read(KEYS.DELETED, { islands: [], photos: [] })
  write(KEYS.DELETED, { islands: [], photos: [] })
  return deleted
}

/** 记录删除（供云同步失败时回写） */
function putBackDeleted(deleted) {
  if (!deleted) return
  const cur = read(KEYS.DELETED, { islands: [], photos: [] })
  cur.islands = cur.islands.concat(deleted.islands || [])
  cur.photos = cur.photos.concat(deleted.photos || [])
  write(KEYS.DELETED, cur)
}

/** 全量覆盖本地数据（云端拉取合并后使用） */
function replaceAll(islands, photos) {
  let changed = false
  if (islands && !isSameData(getIslands(), islands)) {
    write(KEYS.ISLANDS, islands)
    changed = true
  }
  if (photos && !isSameData(getPhotos(), photos)) {
    write(KEYS.PHOTOS, photos)
    changed = true
  }
  if (changed) emit()
  return changed
}

module.exports = {
  onChange,
  isLoggedIn,
  migrateLegacyData,
  clearAccountData,
  getIslands,
  getIsland,
  saveIsland,
  updateIsland,
  deleteIsland,
  getPhotos,
  getPhotosByIsland,
  addPhoto,
  updatePhoto,
  removePhoto,
  getHistory,
  addHistory,
  clearHistory,
  getNotes,
  saveNote,
  deleteNote,
  replaceNotes,
  getProfile,
  saveProfile,
  replaceProfile,
  clearProfile,
  takeDeleted,
  putBackDeleted,
  replaceAll
}
