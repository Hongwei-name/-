/**
 * 云函数：syncPhotos
 * 照片关联数据的云端备份
 *  - 只同步元数据：本地路径字符串 + EXIF 经纬度 + 归属小岛 ID（不传图片本身）
 *  - op=push：批量 upsert（按 localId），并处理删除记录
 *  - op=pull：返回该用户全部照片关联
 *
 * 注意：换设备后本地图片文件不存在（图片未上传服务器），
 * 恢复的关联记录中 localPath 在旧设备上有效。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const COLLECTION = 'photos'

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const col = db.collection(COLLECTION)
  const op = event.op

  if (op === 'push') {
    const photos = event.photos || []
    const deleted = event.deleted || []

    for (const d of deleted) {
      if (!d || !d.id) continue
      await col.where({ _openid: OPENID, localId: d.id }).remove()
    }

    let updated = 0
    let created = 0
    for (const ph of photos) {
      if (!ph || !ph.id) continue
      const doc = {
        localId: ph.id,
        islandId: ph.islandId || '',
        localPath: ph.localPath || '',
        exifLng: ph.exifLng === null || ph.exifLng === undefined ? null : ph.exifLng,
        exifLat: ph.exifLat === null || ph.exifLat === undefined ? null : ph.exifLat,
        shotTime: ph.shotTime || null,
        locationName: ph.locationName || '',
        createdAt: ph.createdAt || Date.now(),
        updatedAt: ph.updatedAt || Date.now()
      }
      const exist = await col.where({ _openid: OPENID, localId: ph.id }).get()
      if (exist.data.length) {
        await col.doc(exist.data[0]._id).update({ data: doc })
        updated++
      } else {
        await col.add({ data: Object.assign({ _openid: OPENID }, doc) })
        created++
      }
    }
    return { ok: true, updated, created }
  }

  if (op === 'pull') {
    const res = await col.where({ _openid: OPENID }).limit(1000).get()
    return { photos: res.data }
  }

  return { ok: false, reason: 'unknown-op' }
}
