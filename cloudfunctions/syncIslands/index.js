/**
 * 云函数：syncIslands
 * 小岛数据（标记景点）的云端备份
 *  - op=push：批量 upsert（按 localId），并处理删除记录
 *  - op=pull：返回该用户全部小岛
 *
 * 注意：云函数端 add 不会自动写入 _openid，需手动写入，保证按用户隔离。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const COLLECTION = 'islands'

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const col = db.collection(COLLECTION)
  const op = event.op

  if (op === 'push') {
    const islands = event.islands || []
    const deleted = event.deleted || []

    // 处理删除记录
    for (const d of deleted) {
      if (!d || !d.id) continue
      await col.where({ _openid: OPENID, localId: d.id }).remove()
    }

    // 批量 upsert
    let updated = 0
    let created = 0
    for (const isl of islands) {
      if (!isl || !isl.id) continue
      const doc = {
        localId: isl.id,
        name: isl.name || '',
        address: isl.address || '',
        lng: isl.lng,
        lat: isl.lat,
        remark: isl.remark || '',
        createdAt: isl.createdAt || Date.now(),
        updatedAt: isl.updatedAt || Date.now()
      }
      const exist = await col.where({ _openid: OPENID, localId: isl.id }).get()
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
    return { islands: res.data }
  }

  return { ok: false, reason: 'unknown-op' }
}
