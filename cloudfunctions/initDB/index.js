/**
 * 云函数：initDB
 * 一键初始化云数据库集合（islands / photos / profiles）
 * 在云开发控制台手动创建集合后无需调用本函数；
 * 也可以在小程序端手动触发一次本函数自动建集合。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

exports.main = async () => {
  const results = {}
  for (const name of ['islands', 'photos', 'profiles']) {
    try {
      await db.createCollection(name)
      results[name] = 'created'
    } catch (e) {
      results[name] = 'exists-or-error: ' + (e.errMsg || e.message)
    }
  }
  return results
}
