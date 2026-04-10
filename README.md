# ST-MusicPlayer
**ST-MusicPlayer 是一款基于 Cloudflare Worker 后端的 SillyTavern 前端音乐播放器扩展**

---

## 📌 项目简介

本项目由以下两部分组成：
- ST-MusicPlayer 前端音乐播放器
- 部属于 Cloudflare Worker 的轻量后端
> 本项目的音乐解析能力由部属于 Cloudflare Worker的后端提供，当前音源解析支持**网易云音乐**与**QQ音乐**。

通过配合后端，ST-MusicPlayer可以实现：
- 在线音乐播放
- 本地歌单管理
- 音乐搜索与单曲/歌单/专辑解析
- 此外， 本项目为 SillyTavern 前端提供了3个暴露至全局的实时播放API

## ❤️ 致谢

本项目后端 Worker 参考改编自以下优秀项目：
- 网易云音乐：[Suxiaoqinx/Netease_url](https://github.com/Suxiaoqinx/Netease_url)
- QQ音乐：[L-1124/QQMusicApi](https://github.com/L-1124/QQMusicApi)

本项目的后台静音保活功能参考自以下优秀项目：
- [SillyTavern/Extension-Silence](https://github.com/SillyTavern/Extension-Silence)

本项目代码全部由ChatGPT/Codex生成。

## 🔵 免责声明

本项目仅供编程学习、代码研究与个人测试使用。请使用者务必遵守所在国家及地区的法律法规，以及相关音乐平台的服务条款。音乐内容、封面、歌词及相关资源的版权均归原权利人所有。使用者应自行承担部署、调用及使用本项目所带来的一切风险与法律责任。

## 📖 使用说明

### 前置需求

- 一个 Cloudflare 账号
- 一个网易云或QQ音乐VIP账号

### 1. 后端 Worker 部署
根据需要部署网易云音乐或QQ音乐的 [Worker](https://github.com/quiet-moss/ST-MusicPlayer/tree/main/worker) ：
- 网易云音乐 Worker：需在 Settings -> Variables and Secrets 中配置密钥 NETEASE_COOKIE 与 ACCESS_TOKEN 
> NETEASE_COOKIE：网易云账号 Cookie；格式示例：MUSIC_U=012346789……12312312909;（包含末尾英文分号）   
> ACCESS_TOKEN：自定义前端鉴权密钥，可以使用UUID；请记住此时设置的ACCESS_TOKEN，之后将再次使用

- QQ音乐 Worker：需在 Settings -> Variables and Secrets 中配置密钥 QQ_COOKIE 与 ACCESS_TOKEN （可选配置： Android 设备标识 QQ_QIMEI 与 QQ_QIMEI36 ）
> QQ_COOKIE：QQ音乐账号 Cookie；格式示例：pgv_pvid=123243……（复制任意请求的完整Cookie值即可）
> ACCESS_TOKEN：自定义前端鉴权密钥，可以使用UUID；请记住此时设置的ACCESS_TOKEN，之后将再次使用

**⚠️ 重要提示 ⚠️**
- COOKIE 与 ACCESS_TOKEN 的变量类型必须设置为 **密钥** ！   
- 此密钥一经部署将不再可见，若遗忘密钥，可轮换此密钥

**❓ 如何获取Cookie**：
- 登录你所使用的音乐平台网页版
- 选择开发者工具（F12），打开网络标签页
- 刷新一次网页（F5）或进行任意请求，复制任意请求的Cookie值

### 2. 安装前端扩展
在 SillyTavern 的扩展标签页安装前端扩展，地址为：
```
https://github.com/quiet-moss/ST-MusicPlayer
```

### 3. 扩展配置
在前端扩展配置面板中提供了“网易云音乐”与“QQ音乐”两个标签页（默认折叠，单击logo即可展开），需要分别为使用的音源填入对应配置：
- **Base URL**：对应的 Worker 部署访问地址
- **Access Token**：与对应 Worker 环境变量中设置一致的密钥
- **默认音质**：选择该音源的默认解析音质档位
> 配置完成后点击保存即可生效。扩展允许在一个用户歌单内混合添加来自不同音源的歌曲，系统会自动路由到对应的 Worker 进行解析。

### 4. 基本使用
- 歌曲搜索 接受关键词搜索
- 歌曲解析｜歌单解析｜专辑解析 接口接受对应平台的歌曲/歌单/专辑 ID（或 MID） 
> 如何获得歌曲/歌单/专辑 ID（或 MID）：打开歌曲/歌单/专辑详情页面，其网址中的第一组数字（或由字母与数字组成的字符串）即为歌曲/歌单/专辑ID；也可通过分享链接获得。

## 🔧 API 接口

扩展加载后，会在前端全局环境暴露 window.STMusicPlayer 对象，提供以下三个仅维护“运行时状态”的播放 API。
> 通过 API 注入的播放队列会直接替换当前播放状态，固定采用列表循环模式，且不会被写入用户保存的本地歌单中。  
> 若在 API 队列播放期间触发原生播放或静音操作，该临时队列会被自动丢弃。

### 1. playByKeyword

```js
window.STMusicPlayer.playByKeyword({
  tracks: [
    { keyword: "歌曲1 歌手A" },
    { keyword: "歌曲2 歌手B" }
  ]
});
```

> 通过关键词模糊搜索并直接播放。系统会调用当前选中音源的搜索接口，提取每个关键词的首个结果生成播放队列。  
> 因为是模糊搜索结果，不能保证一定会播放期望目标。

### 2. playBySourceId

```js
window.STMusicPlayer.playBySourceId({
  tracks: [
    "QQ - 1234567",
    "Netease - 2345678"
  ]
});
```

> 通过“音源标识 - 歌曲ID”的精确格式直接解析并播放。  
> 当前支持 Netease 与 QQ 标识。

### 3. playByUrl

```js
window.STMusicPlayer.playByUrl({
  tracks: [
    {
      name: "歌曲1",
      artist: "歌手A",
      url: "https://example.com/audio/song1.mp3",
      picUrl: "https://example.com/image/song1.jpg",
      album: "专辑A",
      lyric: "[00:00.00]歌曲1"
    }
  ]
});
```

> 使用直链 URL 进行播放，跳过后端的音源解析环节。  
> 其中url为必填项，其他为可选项。

## ⚙️ 后端 Worker API 接口

网易云音乐与QQ音乐的 Worker 采用统一的接口规范。所有接口均要求使用 POST 请求，并携带以下请求头：

```json
 Content-Type: application/json
 X-Access-Token: <ACCESS_TOKEN>
```
 
成功返回格式：

```json
{
  "ok": true,
  "data": {}
}
```

### 1. POST /search

   ```json
   {
     "keyword": "歌曲1",
     "limit": 20
   }
   ```

返回核心字段：

- `data.keyword`
- `data.total`
- `data.songs[]`
  - `id`
  - `name`
  - `artists`
  - `album`
  - `picUrl`


### 2. POST /song

   ```json
   {
     "id": "1234567",
     "level": "lossless"
   }
   ```

返回核心字段：

```json
{
  "ok": true,
  "data": {
    "id": 1234567,
    "name": "歌曲1",
    "artists": "歌手A",
    "album": "专辑A",
    "picUrl": "https://example.com/image/song1.jpg",
    "media": {
      "level": "FLAC",
      "url": "https://example.com/audio/song1.flac",
      "size": 12345678,
      "bitrate": 999000,
      "type": "flac"
    },
    "lyric": {
      "lrc": "原文歌词",
      "tlyric": "翻译歌词"
    }
  }
}
```

> id 需传入对应平台的歌曲数字 ID（QQ 音乐额外支持 MID）。  
> level 为请求的音质（网易云支持如 lossless, standard 等；QQ 音乐支持如 FLAC, MP3_320 等）。

### 3. POST /playlist

   ```json
   {
     "id": "1234567"
   }
   ```

返回核心字段：

- `data.id`
- `data.name`
- `data.trackCount`
- `data.returnedCount`
- `data.songs[]`

> 传入歌单数字 ID。  
> 返回歌单基本信息及内部歌曲列表。为保证前端性能，最多返回前 1000 首歌曲。

### 4. POST /album

   ```json
   {
     "id": "1234567"
   }
   ```

返回核心字段：

- `data.id`
- `data.name`
- `data.artist`
- `data.returnedCount`
- `data.songs[]`

> id 需传入对应平台的专辑数字 ID（QQ 音乐额外支持 MID）。   
> 返回专辑基本信息及内部曲目列表，同样最多返回前 1000 首歌曲。

