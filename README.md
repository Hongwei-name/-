# 行屿 🏝️

> 每一处景点，都是旅途停留的小岛。
> 基于**高德地图开放 API** 开发的微信小程序：地图点位、附近景点发现、小岛（景点）收藏、路线与行程规划、照片 EXIF 地理位置解析与自动归集。

---

## 一、功能清单

| 模块 | 能力 | 状态 |
| --- | --- | --- |
| 基础地图 | 获取当前位置、地图渲染 / 缩放 / 平移、点位标记（收藏小岛 / 普通点位区分展示） | ✅ |
| 附近景点发现 | 自动获取当前位置周边景点（高德周边搜索，风景名胜分类，按距离排序），展示距离 / 评分，支持一键标记小岛、规划路线 | ✅ |
| 地点搜索 | 高德关键词搜索（景点 / 地名 / 地标），搜索历史（查看 / 清空 / 回填），点击结果定位到地图 | ✅ |
| 小岛收藏 | 搜索结果 / 地图点击点位 / 附近景点标记为「我的小岛」，存储名称 / 地址 / 经纬度 / 标记时间 / 备注，支持编辑、删除、列表查看、跳转地图定位 | ✅ |
| 路线规划 | 当前位置为起点，已标记小岛 / 搜索地点为终点；步行 / 骑行 / 驾车 / 公交四种方式；距离、耗时、文字指引；轨迹渲染；多方案切换 | ✅ |
| 行程规划 | 从当前位置出发，对全部已标记小岛做最近邻排序，分段计算路线，展示总距离 / 总耗时 / 站点顺序与轨迹 | ✅ |
| 照片归集（核心） | 相册权限、读取图片、EXIF 提取 GPS（WGS-84 自动转 GCJ-02）、无 GPS 提示、自动匹配小岛、手动改归属 / 手动归类、按小岛查看、单张移除归集（不删原图）；仅存本地路径 + EXIF + 关联 ID | ✅ |
| 小岛相册 | 每座小岛独立照片集合、查看列表、手动选照片直接添加（不依赖 EXIF）、移除关联 | ✅ |
| 数据存储 | 本地缓存全量可用（未登录 / 无网络）；微信云开发登录后云端备份，自动同步 + 手动同步入口 | ✅ |
| 权限 | 地理位置权限（拒绝后提示并引导设置）、相册读写权限（拒绝后照片归集不可用并引导） | ✅ |
| 辅助 | 小岛列表按标记时间 / 距离排序；地图点击任意位置查看点位并直接标记；小岛详情一键发起路线规划 | ✅ |
| 非功能约束 | 搜索 / 逆地理 / 路线全部调用高德开放 API（自有 ApiKey，不入库）；不传原图到服务器；无 GPS 照片不自动归集，提供手动入口 | ✅ |

---

## 二、技术说明

- **框架**：原生微信小程序（WXML / WXSS / JS），无第三方框架，微信开发者工具直接打开。
- **地图渲染**：使用小程序原生 `<map>` 组件（微信内置地图底图）承载点位与路线渲染；**所有地理数据（搜索、周边、逆地理、路线）均来自高德开放 API**，符合业务约束。
- **坐标体系（重要）**：微信 `<map>` 组件、`wx.getLocation({type:'gcj02'})`、高德开放 API 三者**统一使用 GCJ-02（火星坐标）**，可直接互通、无偏移；百度 BD-09 与本项目无关。**唯一需要转换的是照片 EXIF 的 GPS 经纬度（WGS-84）**——代码已在 `utils/photo.js` 提取后自动经 `utils/coord.js` 转为 GCJ-02，避免照片点位与小岛 / 地图永久错位。
- **云端**：微信云开发（云函数 + 云数据库）。未登录 / 未开通云开发时全部核心功能本地可用。
- **照片**：`wx.chooseImage` 选**原图**（保留 EXIF 概率更高），`getFileSystemManager().readFile` 读二进制，内置纯 JS EXIF 解析器提取 GPS（WGS-84 → 自动转 GCJ-02）与拍摄时间；照片**持久化保存到小程序本地用户目录**（临时路径重启会失效）；云端只备份元数据，不传图片。

### 目录结构

```
行屿/
├── project.config.json          # 项目配置（miniprogramRoot / cloudfunctionRoot）
├── miniprogram/
│   ├── app.js                   # 入口：云初始化、静默登录、定位预取
│   ├── app.json                 # 页面、自定义 tabBar、权限声明
│   ├── config/
│   │   ├── index.js             # 公共配置（云环境 ID 等）
│   │   └── private.js           # ★ 高德 ApiKey（已被 .gitignore 排除，不入库）
│   ├── styles/
│   │   ├── iconfont.wxss        # 图标字体样式（字体已 base64 内嵌，无本地文件加载）
│   │   └── fonts/iconfont.ttf   # 图标字体源文件（供工具重新导出 marker 使用）
│   ├── custom-tab-bar/          # 自定义 tabBar（字体图标，无图片依赖）
│   ├── components/top-nav/      # 自定义导航栏（返回 / 搜索模式）
│   ├── images/                  # 地图 marker 图标
│   ├── utils/
│   │   ├── amap.js              # 高德 REST API：搜索 / 周边 / 逆地理 / 路线
│   │   ├── coord.js             # 坐标系转换（WGS-84 <-> GCJ-02）
│   │   ├── exif.js              # JPEG EXIF GPS 解析器（纯 JS）
│   │   ├── photo.js             # 选图 / EXIF 提取 / 坐标转换 / 自动匹配 / 持久化
│   │   ├── storage.js           # 本地数据层（小岛 / 照片 / 历史 / 待删记录）
│   │   ├── cloud.js             # 云同步（push / pull / 合并）
│   │   ├── distance.js          # 经纬度距离计算
│   │   └── util.js              # 通用工具
│   └── pages/                   # 9 个页面（见下）
├── cloudfunctions/              # 云函数
│   ├── login/                   # 获取 openid
│   ├── syncIslands/             # 小岛数据 upsert / 拉取
│   ├── syncPhotos/              # 照片关联 upsert / 拉取
│   └── initDB/                  # 一键创建集合（可选）
└── tools/                       # 工具与测试（图标导出 / 字体解析 / 单元测试）
```

页面：`index`（地图首页）、`search`（发现：附近景点推荐 + 搜索）、`profile`（我的）、`islands`（小岛列表）、`island-detail`（详情 + 照片墙）、`photo-import`（照片归集）、`route`（路线规划）、`tour`（多小岛行程规划）、`mark-edit`（标记 / 编辑）。

### 图标方案

界面图标**不包含任何自制图片**，统一引用 **iconfont.cn 自建项目「行屿」**（线性描边风格，项目 id 5223881）：

- 字体以 **base64 内嵌**在 `styles/iconfont.wxss`（约 9.7KB），不依赖运行时加载，避免本地字体文件在部分真机触发 `Failed to load local font resource`
- 字形映射示例：`icon-search` → `\E63B`（搜索）；完整 16 个映射见 `iconfont.wxss`
- tabBar：自定义 tabBar 组件（`custom-tab-bar/`），图标直接用字体，无 PNG 依赖
- 地图 marker：`images/marker-island.png`（红色）/ `marker-point.png`（蓝色）由字形 `0xE600`（定位图钉）导出；`marker-current.png` 为自行准备的当前位置图标
- 替换图标：在 iconfont.cn 项目里增删图标后重新下载 ttf → 更新 `iconfont.wxss` 中的 codepoint 与 base64；`tools/export-marker-icons.ps1` 负责从字形导出 marker PNG

---

## 三、快速开始

### 1. 导入项目

1. 打开**微信开发者工具** → 导入项目 → 选择本目录。
2. `AppID`：可先用「测试号 / 游客模式」体验基础功能；**使用云开发必须填入自己的小程序 AppID**（`project.config.json` 中 `appid`）。
3. 编译运行。开发阶段建议在「详情 → 本地设置」勾选 **不校验合法域名**。

### 2. 配置高德 ApiKey（必填）

1. 前往 [高德开放平台](https://console.amap.com) 注册并创建应用，服务类型选择 **「Web服务」**。
2. 新建 `miniprogram/config/private.js`（**该文件已被 `.gitignore` 排除，不会提交到仓库**）：

```js
module.exports = {
  AMAP_KEY: '你的高德Web服务Key'
}
```

3. 若没有该文件，代码会回退为占位符，高德相关功能不可用。

4. 上线前在 [微信公众平台](https://mp.weixin.qq.com) → 开发管理 → 开发设置 → 服务器域名，添加 request 合法域名：

```
https://restapi.amap.com
```

> 高德接口均为 GET，无需配置 download/upload 域名。

### 3. 开通云开发（可选，登录后云端备份）

1. 开发者工具顶部「云开发」按钮 → 开通，创建环境。
2. 将环境 ID 填入 `miniprogram/config/index.js` 的 `CLOUD_ENV`（留空则使用默认环境）。
3. 右键 `cloudfunctions` 下每个云函数目录 → **上传并部署（云端安装依赖）**，共 4 个：`login`、`syncIslands`、`syncPhotos`、`initDB`。
4. 创建数据库集合：在云开发控制台创建 `islands`、`photos` 两个集合；或运行一次 `initDB` 云函数自动创建。
5. 集合权限建议：**「仅创建者可读写」**（云函数以管理员权限读写，不受影响；客户端不直接读写集合）。

### 4. 权限说明

`app.json` 已声明：

```json
"permission": {
  "scope.userLocation": { "desc": "用于获取您当前的位置，以便在地图上定位、搜索附近地点和规划路线" }
},
"requiredPrivateInfos": ["getLocation"]
```

- 位置权限：拒绝后地图首页无法定位，相关功能提示不可用并可引导「去设置」。
- 相册权限：首次选择照片时由微信自动拉起，拒绝后照片归集不可用，代码中有引导提示。

---

## 四、重要：照片 EXIF 的现实限制（务必阅读）

小程序读取相册照片的 EXIF 受平台限制，这是所有同类小程序都面临的现实问题：

| 情况 | 表现 | 处理 |
| --- | --- | --- |
| 微信压缩图（`wx.chooseMedia` 默认路径） | EXIF 几乎必然被剥离 | 本项目使用 `wx.chooseImage` + `sizeType: ['original']` 选**原图** |
| 安卓微信 | 原图基本保留 GPS EXIF | 自动归集成功率高 |
| iOS 微信 | 部分版本 / 相册来源会剥离或改写 EXIF，`tempFilePath` 甚至可能不包含 GPS | 解析失败时提示手动归类（需求已内置该兜底） |
| 截图 / 修图软件导出 / 聊天转发图片 | 无 GPS 元数据 | 提示「未检测到位置信息」，手动归类 |

**测试建议**：用手机相机（开启定位）拍摄的照片在**真机**上验证自动归集；开发者工具中照片选择器返回的文件通常已剥离 EXIF，属于正常现象。

---

## 五、数据与同步策略

- **本地优先**：未登录 / 无网络时全部核心功能可用，数据存于小程序 Storage（`xy:islands` / `xy:photos` / `xy:history` / `xy:deleted`）。
- **云端备份**：登录成功后自动全量同步一次（`app.js`），也可在小岛列表页右上角手动「同步」。
- **同步方式**：上传本地全部小岛与照片关联（按 `localId` upsert）→ 拉取云端数据 → 按 `updatedAt` 新者胜合并。删除记录（`xy:deleted`）一并同步，云端同步删除。
- **照片不传原图**：云端仅保存 `localPath`（本地路径字符串）、`exifLng` / `exifLat`、`islandId`。**换设备后本地图片文件不存在**，关联记录仍会恢复（可用于统计与重新归集），但原图仅存在于拍摄设备。
- **清除缓存**：删除小程序或清除 Storage 会清空本地数据；云端备份可再次拉回（需重新登录）。

---

## 六、高德 API 对照

| 能力 | 接口 | 封装位置 |
| --- | --- | --- |
| 关键词搜索 | `GET /v3/place/text` | `amap.searchPlaces` |
| 周边搜索（附近推荐） | `GET /v3/place/around` | `amap.searchAround` |
| 逆地理编码 | `GET /v3/geocode/regeo` | `amap.regeo` |
| 步行 / 骑行 / 驾车 | `GET /v3/direction/{walking,bicycling,driving}` | `amap.direction` |
| 公交 | `GET /v3/direction/transit/integrated` | `amap.direction('transit')` |

> 公交规划必须传 `city`，代码会自动通过起点逆地理获取所在城市；`config.SEARCH_CITY` 可作为兜底。

---

## 七、开发计划 / 已知边界

- [ ] 高德接口签名（SK 鉴权）可选开启，防止 Key 被盗用（`utils/amap.js` 预留扩展位）
- [ ] 照片 EXIF 解析对 HEIC 格式的支持（iOS 原图可能为 HEIC，需后续验证）
- [ ] 云端同步为全量模式，个人数据量级下无性能问题；如数据量大可升级为增量 / 时间戳分页
- [ ] 附近景点推荐支持分类筛选（美食 / 住宿 / 购物等，目前仅风景名胜）
- [ ] 行程规划支持公交方式与多方案选择（目前步行 / 骑行 / 驾车）

---

## 八、License

内部项目，仅供学习与功能开发参考。使用高德 API 请遵守高德开放平台服务条款。
