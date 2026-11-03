# 学习通签到助手

手机浏览器打开就能用的签到工具：**位置签到 + 人脸签到 + 定时自动签到**。
零依赖（只要求装了 Node.js），不需要 npm install，不需要编译，iPhone / 安卓都能用。

---

## 登录是真的吗

真的。直接 `POST passport2.chaoxing.com/fanyalogin`，账号密码用学习通自己的 `AES-128-CBC` 加密，
拿到的是学习通发的真会话 cookie。用错误密码请求，服务器原话：

```
HTTP 200
Set-Cookie: JSESSIONID, route
{"msg2":"账号密码错误，请重新输入，错误输入6次后将被冻结15分钟","status":false}
```

`JSESSIONID` / `route` 是学习通 Tomcat 的会话与路由 cookie；
「错误6次冻结15分钟」是它服务端的账号策略 —— 本地模拟不可能编出这种字段。

登录后再 `POST sso.chaoxing.com/apis/login/userLogin4Uname.do` 交设备指纹，换回 `puid`、`fid`、`clientId`，
`clientId` 解开就是 `cxcid` + `sc`，后面人脸签名的 `signToken` 就靠它。

---

## 为什么是「网页」而不是小程序 / App

| 方案 | 能不能用 | 结论 |
|---|---|---|
| 微信小程序 | 网络请求必须走**你自己备案的 HTTPS 域名**白名单，学习通的域名你加不进去；工具类还会被审核驳回 | ❌ 还要额外搭中转，纯亏 |
| 原生 App | 能跑，但要打包、装 APK、iOS 直接没有；改一行代码重新签名 | ⚠️ 维护成本最高 |
| **网页 + 本机后端** | 手机浏览器输入一个地址就行，可「添加到主屏幕」当 App 用；定时任务跑在后端，**手机都不用开** | ✅ 采用 |

所以本项目 = **Node 后端（干活）+ 单页 PWA（遥控器）**。
后端负责所有学习通请求和定时调度，前端只是界面，因此不存在 CORS 问题，也不受手机系统杀后台影响。

---

## 先讲清楚一个技术事实：人脸怎么过

学习通的人脸签到流程是两步：

1. 客户端调 `pptSign/check-face-result`，把一段 `faceResult` JSON 交上去，换回 `faceEnc`；
2. 真正的签到请求带上 `faceEnc` + `currentFaceId`。

关键在 `faceResult` 里这两个字段：

```json
{ "currentFaceId": "<云盘照片 objectId>",
  "LiveDetectionStatus": 1,
  "collectStatus": 1,
  "cxtime": "1700000000000",
  "cxcid": "<设备指纹中的 cid>",
  "signToken": "md5(排序拼接字段 + sc)" }
```

**`LiveDetectionStatus`（活体检测结果）是客户端自己填的。**
服务端不重跑活体，只校验 `signToken` —— 也就是 `md5(按字典序拼接的字段 + sc)`，其中 `sc` 来自 RSA 加密的设备指纹 `clientId`（本工具用公钥裸解拿到的那个）。

所以「要求眨眼」这道关，拦的是**老实调 API 的客户端**，不是在服务端做真人核验。
你要骗过的不是人脸模型，是一个 MD5。

`currentFaceId` 用的是**你本人档案里那张照片**的 objectId（学校采集的那张，也就是服务端拿来比对的基准图）。本工具直接把它拉下来复用，所以比对的是「你 vs 你」，相似度天然满分。没有档案照的账号，可以上传一张你自己的正脸照到学习通云盘，拿它的 objectId 用。

> 顺带说：这就是为什么网上那些工具能过。不是因为它们会「伪造视频」，而是因为这道校验压根没在服务端做。

---

## 坐标系：唯一容易翻车的地方

中国的地图有三套坐标：`WGS-84`（GPS 原始）、`GCJ-02`（高德/腾讯，火星坐标）、`BD-09`（百度）。

- 本工具的地图底图是**高德瓦片**，界面上显示的是 **GCJ-02**；
- 提交给学习通的坐标，基准由你在「地点」页选，**默认 BD-09**（这是已验证可用的方案用的基准）；
- **最保险的做法**：点签到列表里的「取点」，直接把服务端下发的老师签到点坐标原样复用 —— 零换算，误差就是 0 米。

如果签到老是提示「不在范围内」，就换一个基准再试，或者用「取点」。

---

## 手机怎么用（三条路，按需选）

后端必须有台机器一直开着。**有服务器就走 ③，最省心**；只想先用用看走 ①。

### ① 电脑 + 手机（最快，适合先用用看）

```bat
start.bat
```

启动后**在电脑上打开页面**，签到页底部有一张「手机扫这个码」，手机扫一下就行。
前提：手机和电脑连同一个 Wi-Fi，电脑别睡眠。

> 第一次打开 Windows 可能弹防火墙提示，要**允许专用网络**，否则手机连不上。

### ② 手机自己跑（Android，彻底脱开电脑）

这条路不需要任何网络互通，也不受校园网隔离影响。全程约 10 分钟。

**第 1 步：装 Termux**

去 [F-Droid](https://f-droid.org/packages/com.termux/) 下载安装。
**别用 Play 商店那个**，那个版本早就停更，`pkg` 装不了新包。

> 国产 ROM（小米/华为/OPPO/vivo）装完记得关掉「纯净模式」或允许安装未知来源。

**第 2 步：把包传到手机**

把 `cx-sign-phone.tar.gz`（106 KB）传进手机，随便哪种方式都行：
数据线复制到「下载」、微信/QQ 发给自己、网盘下载 —— 都行。

**第 3 步：在 Termux 里解压**

```bash
termux-setup-storage          # 弹窗点「允许」，让 Termux 能读下载目录
mkdir -p ~/cx-sign
tar xzf ~/storage/downloads/cx-sign-phone.tar.gz -C ~/cx-sign
cd ~/cx-sign
```

> 找不到文件就先 `ls ~/storage/downloads/` 看看实际叫什么。
> 用微信传的话通常在 `~/storage/downloads/` 下的 `WeiXin` 目录里。

**第 4 步：一键装完并启动**

```bash
bash termux-setup.sh
```

脚本会自动：装 Node.js → 跑加密自检 → 拿唤醒锁 → 起服务 → 打开浏览器。

**第 5 步：打开**

手机浏览器访问 `http://127.0.0.1:8686`，浏览器菜单里「添加到主屏幕」，就是个 App。

**第 6 步（关键，别漏）**

设置 → 应用 → Termux → 电池 → **「无限制 / 允许后台活动」**。
不做这步，跑几小时会被系统杀掉，定时签到就废了。

**可选：开机自启**

装 [Termux:Boot](https://f-droid.org/packages/com.termux.boot/) 插件，然后：

```bash
mkdir -p ~/.termux/boot
cp ~/cx-sign/termux-boot.sh ~/.termux/boot/10-cx-sign.sh
chmod +x ~/.termux/boot/10-cx-sign.sh
```

重启手机后服务会自动拉起，配合定时签到就是真正的无人值守。

### ③ 云服务器（24 小时在线，最省心 —— 推荐）

有服务器就走这条，不用管什么局域网、客户端隔离、IP 变不变。

**第 1 步：传上去**

```bash
scp cx-sign-phone.tar.gz root@你的服务器IP:/root/
```

**第 2 步：解压 + 一键部署**

```bash
ssh root@你的服务器IP
mkdir -p /opt/cx-sign
tar xzf cx-sign-phone.tar.gz -C /opt/cx-sign
cd /opt/cx-sign
sudo bash deploy.sh
```

脚本会自己做完这些：装 Node 20 → 建运行用户 → 装到 `/opt/cx-sign` →
写 systemd 服务（开机自启、崩溃自动拉起）→ 放行防火墙 → 生成随机口令 → 打印访问地址。

跑完屏幕上会直接给你：

```
打开： http://你的服务器IP:8686
口令： a54beff64c18
```

手机浏览器打开，输口令，添加主屏幕，完事。

**常用参数**

```bash
sudo bash deploy.sh --port=9000        # 换端口
sudo bash deploy.sh --pin=myPass888    # 指定口令（默认随机 12 位）
sudo bash deploy.sh --dry-run          # 只打印要做什么，不动系统
sudo bash deploy.sh --uninstall        # 卸载服务，保留数据
```

**日常运维**

```bash
sudo journalctl -u cx-sign -f          # 看日志
sudo systemctl restart cx-sign         # 重启
sudo systemctl status cx-sign          # 状态
```

**更新代码**：重新上传 `tar.gz`，解压覆盖，再跑一遍 `deploy.sh`（`data/` 会保留，账号和计划不丢）。

> ⚠️ **云厂商安全组要单独放行**。deploy.sh 只能改服务器本机防火墙，
> 阿里云/腾讯云/华为云还要去控制台 → 安全组 → 入方向，加一条 `8686` 端口的规则。
> 这一步漏了是最常见的「部署成功但外网打不开」。

> ⚠️ 公网暴露一定要设口令。这个页面等于你的学习通账号。
> 已内置防爆破：同一 IP 错 8 次锁 15 分钟。

**Docker 也行**：

```bash
docker build -t cx-sign .
docker run -d --name cx-sign --restart=always \
  -p 8686:8686 -e PIN=你的口令 \
  -v "$PWD/data:/app/data" cx-sign
```

---

## 手机连不上 / 一直转圈怎么修

先做一次 60 秒自测，能立刻分清是「网络不通」还是「页面问题」：

手机浏览器打开 `http://<电脑IP>:8686/ping`

| 结果 | 含义 | 怎么办 |
|---|---|---|
| 显示 `pong` | 网络**是通的** | 刷新页面即可；还慢就开飞行模式再关，换掉坏 DNS 缓存 |
| 一直转圈 / 连接超时 | 网络**根本没通** | 往下看 |
| 立刻报「拒绝连接」 | 服务没启动 / 端口被占 | 重新跑 `start.bat`，看终端有无报错 |

### 网络不通的四个原因（按概率排）

1. **校园网开了客户端隔离**（`HUEL_WIRELESS` 这类最常见）
   同一 Wi-Fi 下设备之间也互相看不见。这是网络策略，改代码没用。
2. **手机在 4G/5G 上**，没连 Wi-Fi。`10.x` / `192.168.x` 都是内网地址，外网够不到。
3. **两个设备连的不是同一个 SSID**（比如 `XU_5G` 和 `XU_2.4G` 判断成两个网）。
4. **校园网未认证**：很多学校把没登录认证页的设备丢进隔离区，两个设备都要先过一次认证。

### 三个真能绕过的办法

**A. 手机开热点，电脑连热点** —— 2 分钟，最省事

手机开「个人热点」→ 电脑 Wi-Fi 连上热点 → 重启 `start.bat` → 看终端新打印的 IP（一般是 `192.168.43.x`）→ 手机打开那个地址。
热点是没有隔离的私有网络，稳。

**B. 数据线 + USB 反向代理** —— 完全不依赖 Wi-Fi

手机开「开发者选项 → USB 调试」，插线，电脑装好 adb 后：

```bat
adb reverse tcp:8686 tcp:8686
```

然后手机浏览器打开 `http://127.0.0.1:8686`。数据线走的是本机回环，校园网怎么隔离都不影响。

**C. 直接在手机上跑**（推荐，彻底不要电脑）

见上面「② 手机自己跑」。跑通之后手机访问 `127.0.0.1:8686`，没有任何网络依赖。

> 顺带说：`169.254.x.x` 是网卡没拿到 DHCP 时自己瞎填的地址，本工具已经从二维码里剔除了；
> VMware / VirtualBox / Hyper-V / Tailscale 这类虚拟网卡也不会显示出来，避免扫到假地址。

---

## 用法

1. **签到页** → 登录，两种方式任选：
   - **账号密码**：手机号 + 密码（密码用学习通自己的 AES 密钥加密后存在本机，会话过期可静默重登）
   - **扫码登录**：点「扫码登录」出二维码，用学习通 App 右上角「扫一扫」确认即可，不用输密码

   > 扫码登录拿到的会话**没有存密码**，所以过期后不能自动续，得重新扫一次。
   > 长期无人值守建议用账号密码登录。
   >
   > 短信验证码登录没做：学习通发短信前要先过滑块验证码（`/num/phonecode` 缺 `validate` 直接返回「验证串为空」），
   > 而且验证码登录的提交接口没有公开可用路径（试了 6 个候选全部 302）。扫码能完全替代，还少一步。
2. **课程页** → 登录后自动拉取「我的课程」，也可以手动刷新；点某门课的「查签到」只扫那门课
3. **人脸页** → 点「从本人档案拉取」，拿到 objectId 并显示预览图
4. **地点页** → 拖动地图到教学楼，选基准，保存成常用地点（可以存多个，第一个是默认）
5. **签到页** → 「扫描当前签到」→ 列表里出现活动，点「签到」

> ⚠️ **密码别试错**：学习通连续输错 6 次会冻结 15 分钟。记不清先去 App 里确认。
> 这里是真的登录，不是本地模拟 —— 见下面「登录是真的吗」。

### 定时自动签到

1. **计划页** → 设定时间（如 07:50）、值守时长（如 20 分钟）、星期、课程、地点
2. **签到页** → 打开「自动签到」总开关

到点后它不会盲签，而是进入**值守窗口**：每 30 秒扫一次课程活动列表，一发现新签到立刻抢。老师的签到往往只开 1~2 分钟，这才是能抢到的关键。

计划可以设多个，`课程 = 全部课程` 时对所有课生效。

---

## 接口对照（方便你以后自己改）

| 用途 | 接口 |
|---|---|
| 登录 | `POST passport2.chaoxing.com/fanyalogin` |
| 设备指纹 | `POST sso.chaoxing.com/apis/login/userLogin4Uname.do` |
| 课程列表 | `GET mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json&rss=1` |
| 活动列表 | `GET mobilelearn.chaoxing.com/v2/apis/active/student/activelist` |
| 签到点信息 | `GET mobilelearn.chaoxing.com/v2/apis/active/getPPTActiveInfo` |
| 签到预热 | `POST mobilelearn.chaoxing.com/newsign/preSign` |
| 人脸换 enc | `GET mobilelearn.chaoxing.com/pptSign/check-face-result` |
| 提交签到 | `GET mobilelearn.chaoxing.com/pptSign/stuSignajax` |
| 档案人脸照 | `GET mobilelearn.chaoxing.com/v2/apis/sign/collectionfilephotoEnc` |
| 云盘上传 | `POST pan-yz.chaoxing.com/upload` |

加密要点：

- 账号 / 密码：`AES-128-CBC`，key = iv = `u2oh6Vu^HWe4_AES`，再 base64
- 设备指纹：`RSA/PKCS1` 分段（每段明文 117 字节）加密成 `data` 表单字段
- `clientId`：用同一个**公钥**做裸 RSA 解（`publicDecrypt` + `RSA_NO_PADDING`），去掉 `00 01 FF.. 00` 填充后即 JSON
- `signToken`：字段按 `TreeMap` 字典序拼 `key+value`，末尾接 `sc`，取 `md5`

---

## 自检

```bash
node test/selftest.js
```

覆盖：AES 传输加密一致性、clientId 的 PKCS#1 type-1 裸解与分段还原、设备指纹稳定性、`faceResult` 排序拼接顺序、WGS-84→GCJ-02 换算基准。

---

## 限制（提前说，省得你踩坑）

- **滑块验证码过不了**。部分签到会要求 `captcha`，本工具会明确告诉你「需要滑块验证码」，这种情况只能手机 App 手动签一次。
- **同一设备不允许重复签到**：学习通会比对 `deviceCode`，所以每个账号的 `deviceCode` 是独立派生的；如果你把这个工具同时给多个同学用，务必每个账号各自登录（本工具按账号隔离）。
- **签到点范围**由老师设定（通常 100~200 米）。误差主要来自坐标系选错，不是随机抖动 —— 本工具已在范围内加了 ±5 米抖动，看起来不像个假点；若被判超范围会自动收紧到 ±1 米重试一次。
- 学习通改接口就会失效。协议集中写在 `lib/cx.js`，改一处即可。
- 账号密码存在 `data/db.json` 里（AES 加密后的密码 + cookie）。这个文件等于你的账号，**别外传、别提交到公开仓库**。

---

## 目录

```
server.js                入口：读配置 → 组装依赖 → 挂路由 → 起服务（~130 行）
lib/config.js            端口 / 口令 / 目录，全部来自环境变量
lib/http.js              JSON 响应、请求体、Cookie
lib/router.js            路由表（支持 /api/places/:id 这种参数）
lib/pin.js               访问口令 + 防爆破
lib/session.js           登录会话 + 过期静默重登
lib/static.js            静态资源：gzip/brotli + ETag/304 + 长缓存 + 前端合包
lib/net.js               网卡地址、当前地址文件
lib/sign-helpers.js      坐标来源、activeId 解析
lib/cx.js                学习通协议层（加密、登录、课程、签到、人脸、扫码）
lib/scheduler.js         定时值守调度
lib/store.js             JSON 持久化

routes/                  每个文件一类接口，改哪个找哪个
  auth.js                登录：账号密码 / 扫码 / 退出
  state.js               状态总览
  courses.js             课程与活动扫描
  sign.js                签到统一入口 / 批量 / 定时
  face.js                人脸照片
  places.js              常用地点
  plans.js               定时计划
  index.js               汇总注册

public/                  前端（PWA）
  js/                    前端源码，按模块拆分（见下）
  vendor/                Leaflet + 二维码生成（本地化，不依赖外网 CDN）

termux-setup.sh          在安卓手机上直接跑（Termux），一键安装
termux-boot.sh           开机自启（配合 Termux:Boot 插件）
cx-sign-phone.tar.gz     部署包（含全部离线依赖）
Dockerfile               云服务器部署
test/selftest.js         自检
data/db.json             运行时数据（账号、地点、计划）
```

### 前端怎么改

`public/js/` 里是拆分后的源码，浏览器请求的仍然是单个 `/app.js`——
服务端按 `public/js/manifest.json` 在运行时拼接，**不需要构建工具**。
改完刷新页面即生效，源文件 mtime 变了 ETag 自动跟着变。

```
10-base.js        工具函数 / 按需加载 / 网络 / 坐标换算
20-core.js        状态刷新、渲染入口
30-view-sign.js   签到页
31-view-courses.js 课程页
32-view-places.js  地点页 + 地图
33-view-face.js    人脸页
34-view-plans.js   计划页
35-phone-card.js   手机访问入口卡片
40-actions.js      所有按钮动作
50-boot.js         启动
```

新增一个模块：在 `public/js/` 建文件，往 `manifest.json` 的 `files` 数组里加一行即可。
```

> 地图瓦片走的是高德，需要联网；Leaflet 和二维码库已经放进 `public/vendor/`，
> 因为 jsdelivr 在国内不通、unpkg 慢，用 CDN 会让手机端白屏。
