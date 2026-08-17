/**
 * 全局配置
 *
 * 1. AMAP_KEY：高德开放平台 Web 服务 Key
 *    - 申请地址：https://console.amap.com/dev/key/app
 *    - 服务类型选择「Web服务」，用于搜索 / 逆地理 / 路线规划等 REST API
 *    - ★ 真实 Key 存放在 miniprogram/config/private.js（已被 .gitignore 排除，不随仓库公开）；
 *      本地没有 private.js 时回退为占位符
 * 2. CLOUD_ENV：微信云开发环境 ID
 *    - 在微信开发者工具中开通「云开发」后，把环境 ID 填到这里；
 *    - 留空则使用默认环境（wx.cloud.init 不传 env）。
 */

// 尝试加载私有配置（不存在时静默回退占位 Key）
let privateConfig = {}
try {
  privateConfig = require('./private')
} catch (e) {
  // private.js 不存在：使用占位符，提示自行配置
}

module.exports = {
  // 高德 Web 服务 ApiKey（真实 Key 见 config/private.js）
  AMAP_KEY: privateConfig.AMAP_KEY || 'YOUR_AMAP_WEB_KEY',

  // 微信云开发环境 ID（留空使用默认环境）
  CLOUD_ENV: '',

  // 照片自动归集的匹配半径（米）：照片 GPS 与已标记小岛距离在此范围内才自动归集
  MATCH_RADIUS_M: 1000,

  // 搜索默认城市（留空为全国范围搜索，可填如 '杭州' 提升本地结果精度）
  SEARCH_CITY: '',

  // 云函数名称
  CLOUD_FN: {
    LOGIN: 'login',
    SYNC_ISLANDS: 'syncIslands',
    SYNC_PHOTOS: 'syncPhotos',
    INIT_DB: 'initDB'
  }
}
