/**
 * 本地数据层（小程序的 Storage）
 *
 * 数据模型：
 *  - island（小岛/标记景点）：{ id, name, address, lng, lat, remark, createdAt, updatedAt }
 *  - photo（照片关联）：{ id, islandId, localPath, exifLng, exifLat, shotTime, locationName, createdAt, updatedAt }
 *  - history（搜索历史）：[{ keyword, time }]
 *  - profile（本地用户资料）：{ nickName, avatarUrl, updatedAt }
 *  - deleted（待同步删除）：{ islands: [{id, updatedAt}], photos: [...] }
 *
 * 约束：不存储原图到服务端，仅保存图片本地路径 + EXIF 经纬度 + 关联小岛 ID。
 */
const util = require('./util')

const KEYS = {
  ISLANDS: 'xy:islands',
  PHOTOS: 'xy:photos',
  HISTORY: 'xy:history',
  DELETED: 'xy:deleted',
  PROFILE: 'xy:profile'
}

const listeners = []

function read(key, fallback) {
  try {
    const val = wx.getStorageSync(key)
    return val === '' || val === null || val === undefined ? fallback : val
  } catch (e) {
    return fallback
  }
}

function write(key, val) {
  try {
    wx.setStorageSync(key, val)
  } catch (e) {
    console.warn('[storage] 写入失败', key, e)
  }
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
  if (islands) write(KEYS.ISLANDS, islands)
  if (photos) write(KEYS.PHOTOS, photos)
  emit()
}

module.exports = {
  onChange,
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
  getProfile,
  saveProfile,
  replaceProfile,
  takeDeleted,
  putBackDeleted,
  replaceAll
}
