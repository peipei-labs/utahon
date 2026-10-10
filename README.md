# Utahon 歌本 🎵

> 从喜欢的歌入手学日语 — 歌词 / 音译 / 翻译 / 词性标注，配合慢放、循环与可编辑和弦草稿。

![首页歌单](docs/screenshots/home-desktop.png)

---

## ✨ 特色

- 🤖 **lrclib + Gemini 双引擎标注**：lrclib 拉歌词，Gemini 3.1 Flash Lite 自动生成汉字注音、罗马音、逐词词性、自然中文翻译
- 🎬 **YouTube / Bilibili 双源**：yt-dlp 抓音频流，Gemini 多模态转录 lrclib 未收录的翻唱歌；cookies 方案绕过两家反爬
- 🔁 **SSE 流式批量导入**：频道 URL 一贴 实时进度逐首滚动 避开 Cloudflare 100s 超时
- 🧯 **Gemini 模型容错**：Primary 503 过载自动降级到 Fallback 模型 单进程记忆避免反复试错
- ✍️ **原曲/翻唱双作者字段**：`Akashi Myu · 原曲 saewool · 31 行` 翻唱党友好
- ⌨️ **极简输入**：频道贴 `@akashimyu`、重转贴 `BV1USAQzDEav` 或 `dQw4w9WgXcQ`，完整 URL 同样接受
- 🎸 **弹唱练习台**：YouTube 或自有音频均可保留音高慢放、A/B 循环、段落循环和前后留白
- 🎼 **可编辑和弦草稿**：自动和弦贴到对应歌词行，支持常用指法图、简化和弦、Capo 换指法和 ChordPro 导出；不是含节奏、拨弦信息的完整六线谱
- 🎚️ **四轨练习混音**：Demucs 分出人声、鼓、贝斯、其他四轨，可逐轨调音量、静音或独听
- 🔊 **按需发音**：Edge Nanami / Keita，无需常驻语音模型；线上失败时有提示，有可用日语系统音色时可回退到本机朗读

自动转录、翻译和和弦都可能出错。歌曲页提供歌词纠错与播放来源编辑；修改歌词后重新分析，失败时保留原内容。未人工核对的内容不要当作标准答案。模型输出会检查行数、顺序与词语拼回原文，但这些检查不能代替听歌校对。

---

## 📷 效果预览

### 📱 移动端

<table>
  <tr>
    <td><img src="docs/screenshots/home-mobile.png" width="280" alt="首页歌单"></td>
    <td><img src="docs/screenshots/song-detail-mobile.png" width="280" alt="歌曲详情"></td>
    <td><img src="docs/screenshots/import-mobile.png" width="280" alt="批量导入"></td>
  </tr>
  <tr>
    <td align="center"><sub>首页歌单</sub></td>
    <td align="center"><sub>歌曲详情</sub></td>
    <td align="center"><sub>批量导入</sub></td>
  </tr>
</table>

### 🖥️ 桌面端

**歌曲详情：歌词 + 罗马音 + 中文 + YouTube 嵌入播放**

![歌曲详情](docs/screenshots/song-detail-desktop.png)

**批量导入：一贴频道 一键拉全**

![批量导入](docs/screenshots/import-desktop.png)

---

## 🏗️ 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Next.js 16 (App Router + Turbopack) · React 19 · TypeScript 5 · Tailwind CSS 4 · framer-motion |
| 后端 | Next.js Route Handlers · Node.js runtime · SSE ReadableStream |
| 存储 | SQLite (better-sqlite3) · WAL mode |
| AI | Gemini 3.1 Flash Lite（歌词分析 / 分享解析）· Gemini 3.6 Flash（音频转录）· AI Gateway 或 Google 直连 |
| 音乐分析 | lv-chordia 1.1.0 · allin1 1.1.0 · Demucs 4 · PyTorch（M5 本地一次性运行） |
| 歌词源 | [lrclib.net](https://lrclib.net) |
| 音频源 | yt-dlp (uv-managed venv) · YouTube + Bilibili cookies |
| 反向代理 | Caddy 2.11 · Cloudflare Origin Certificate · HTTP/3 |
| CI/CD | GitHub Actions (appleboy/ssh-action) · systemd |

---

## 🚀 本地开发

```bash
# 安装依赖
npm install
uv sync                    # yt-dlp 与 EJS 脚本（YouTube 使用已有 Node 22+）

# 配置 .env.local（推荐走个人 AI Gateway）
AI_GATEWAY_BASE_URL=https://gateway.peipei.dev
AI_GATEWAY_API_KEY=...
GEMINI_ANALYZE_MODEL=gemini-3.1-flash-lite
GEMINI_SHARE_MODEL=gemini-3.1-flash-lite
GEMINI_TRANSCRIBE_MODEL=gemini-3.6-flash
GEMINI_FALLBACK_MODEL=gemini-2.5-flash-lite
YOUTUBE_COOKIES_PATH=./account_auth/www.youtube.com_cookies.txt    # 可选
BILIBILI_COOKIES_PATH=./account_auth/www.bilibili.com_cookies.txt  # 可选

# 启动
npm run dev
```

打开 `http://localhost:3000` 即可。

`AI_GATEWAY_BASE_URL` 填网关根地址，不要附加 `/v1` 或 `/v1beta`。网关地址和 key 必须同时设置；未设置时会继续读取 `GOOGLE_AI_API_KEY` 直连 Google。旧的 `GEMINI_MODEL` 仍可作为三个任务的统一模型配置，任务专用变量优先级更高。

### 🎸 生成练习谱与分轨

歌曲页点击「从视频取得音频」，即可把当前 YouTube / Bilibili 来源保存成练习音频；也可以填写另一条视频链接、视频 ID 或 BV 号。无需先下载到电脑再上传。没有可用视频来源、下载受限时，仍可点「上传音频文件」上传自己持有的音频。请确认音频与歌词是同一录音版本，否则歌词时间可能对不上。

取得音频后就能慢放和循环。和弦、节拍、段落与分轨仍需在 Apple Silicon Mac 上按需分析，不会自动启动常驻模型。练习台提供可复制的完整命令；运行后会通过 SSH 自动拉取 VPS 音频，再把结果导回对应歌曲。

```bash
# 首次安装分析环境（Python 3.10，由 uv 管理）
cd audio-worker
./setup.zsh

# 和弦 + BPM/节拍/段落 + Demucs 四轨，一次完成
uv run --no-sync python utahon_analyze.py --song <song-id>

# 只生成可编辑和弦草稿
uv run --no-sync python utahon_analyze.py --song <song-id> --phase chords

# 更慢但更完整的 8 模型结构集成
uv run --no-sync python utahon_analyze.py \
  --song <song-id> --allin-model harmonix-all
```

默认 SSH alias 是 `2c2g5-c`，远端目录是 `/opt/utahon`；可用 `--host` 和 `--remote-root` 覆盖。自动分析不会覆盖手工改过的和弦、段落、Capo 或谱面显示选择。练习音频与四轨保存在 `data/practice/`，不进入 Git。

替换练习音频需要确认：不同音频会清除旧自动分析，保留仍在新音频时长内的人工和弦与段落；旧音频移入 `data/trash/`。重复取得完全相同的音频会保留已有分析。下载失败或下载期间歌曲/练习已变化时，不覆盖原内容。

运行上述命令后，页面会刷新分析状态；若你同时在编辑，草稿会保留，需确认载入最新结果后再保存，过期保存会被拒绝。无精确指法的和弦显示缺失，不会用其他和弦的图替代。视频下载受来源站可用性、登录状态和网络影响，失败时页面会提示换来源或上传音频。

### 发音与测试

VOICEVOX 已停用，旧 Azure 配置不再参与发音。旧音色偏好自动切换到 Nanami；网页不会启动或连接 VOICEVOX。需要恢复该服务时应另行明确配置，而不是依靠容器自动重启。

```bash
npm test
uv run --project audio-worker --no-sync python -m unittest discover -s tests -p test_worker_merge.py
npm run build
```

`npm test` 使用独立临时数据库，不改歌库。`npm run test:practice` 是有写入的 API 集成测试，只能在隔离测试实例运行，不要指向生产歌曲库。

---

## 🌐 生产部署

本仓库自带 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) 一条命令 push 即部署：

```
push to master
  ↓ GitHub Actions
  ↓ SSH 到 VPS /opt/utahon
  ↓ git pull --ff-only
  ↓ npm ci && npm run build
  ↓ systemctl restart utahon
```

**反向代理**：Caddy 2.11 + Cloudflare Proxied + Origin Certificate（15 年免签）+ Basic Auth  
**数据卷**：`/opt/utahon/data/utahon.db` (SQLite) · `/opt/utahon/data/practice/`（自有音频与分轨）
**cookies**：`/opt/utahon/account_auth/` 目录 chmod 700（已 gitignore）

---

## 📄 License

MIT

---

*Made with ♡ by [xPeiPeix](https://github.com/xPeiPeix)*
