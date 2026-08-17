/**
 * 云函数：syncProfile
 * 用户资料只按调用者 OPENID 读写，客户端不直接访问 profiles 集合。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const COLLECTION = 'profiles'

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const col = db.collection(COLLECTION)

  if (event.op === 'pull') {
    const res = await col.where({ _openid: OPENID }).limit(1).get()
    if (!res.data.length) return { profile: null }
    const profile = res.data[0]
    return {
      profile: {
        nickName: profile.nickName || '',
        avatarUrl: profile.avatarUrl || '',
        updatedAt: profile.updatedAt || 0
      }
    }
  }

  if (event.op === 'push') {
    const profile = event.profile || {}
    const doc = {
      nickName: String(profile.nickName || '').slice(0, 20),
      avatarUrl: String(profile.avatarUrl || ''),
      updatedAt: profile.updatedAt || Date.now()
    }
    const exist = await col.where({ _openid: OPENID }).limit(1).get()
    if (exist.data.length) {
      await col.doc(exist.data[0]._id).update({ data: doc })
    } else {
      await col.add({ data: Object.assign({ _openid: OPENID }, doc) })
    }
    return { ok: true }
  }

  return { ok: false, reason: 'unknown-op' }
}
