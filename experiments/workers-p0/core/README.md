# 精简媒体核心源码构建

构建器只用于开发机；部署产物是 JavaScript + 单线程 Wasm。Windows 使用已有 WSL 的 gcc/make/pkg-config/Python，未部署容器，也不要求运行服务器进程来处理视频。

## 本机重现

所有源码和工具链默认位于 `G:/DevCache/Temp/pi-agent-hypite/workers-p0/source-build`。首次需下载 Emscripten（压缩包约 353 MB）、Node、CMake 和源码；展开后占数 GB，先检查 G 盘空间。不要在 WSL 根盘安装这些依赖。

```powershell
wsl -d Ubuntu-24.04-EdgeHome -- bash /mnt/g/Projects/Pi-Agent-Hypite/experiments/workers-p0/core/build-fast-wsl.sh
cd G:/Projects/Pi-Agent-Hypite/experiments/workers-p0
npm run build:minimal
npm run check
npm test
npm run prepare:font
npm run fixtures
npm run matrix
npm run bench -- --repeat 20 concat render-1 render-2 render-3 final
```

Windows 加速脚本在 G 盘缓存目录新建 8 GiB 的 ext4 镜像文件，仅对新文件初始化，绝不格式化现有文件/磁盘。构建时临时挂载，完成或失败后导出日志并卸载；release 导回 G 盘可直接读取的 `source-build/release`。这样避免 WSL 跨 NTFS 编译大量小文件的开销。镜像需要已有 WSL 的 root 挂载权限；普通 Linux 使用 `build-source.sh` 即可。

其他 Linux 开发机显式设置 `P0_BUILD_ROOT` 为有足够空间的构建目录；`P0_BUILD_JOBS` 默认 4。Windows/Node 侧可用 `P0_CORE_SOURCE_DIR` 指向其 `release` 目录。既有通用核心比较入口仍是 `npm run build`，不会静默回退；缺少精简核心时 `build:minimal` 必须失败。

## 来源与构建记录

`sources.lock.json` 锁定每份源码的提交，构建前检查提交和 tracked diff。源码仓库缓存不进入主仓库。`build-source.sh` 保留 FFmpeg 配置、源码版本、脚本/探测器哈希、JS/Wasm 哈希和许可证到 `release`。`prepare-core.mjs` 在接入 Worker 前再次核对文件哈希。

- 上游包装和 patched CLI：[ffmpeg.wasm v0.12.10](https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10)。不使用其浏览器 Web Worker 包装或 Docker 构建器。
- 媒体库：[FFmpeg n5.1.4](https://github.com/FFmpeg/FFmpeg/tree/n5.1.4)、[x264 fork](https://github.com/ffmpegwasm/x264)、[FreeType fork](https://github.com/ffmpegwasm/freetype2)。精确提交见 lock 文件。
- 工具链：[Emscripten 3.1.40](https://github.com/emscripten-core/emsdk/tree/3.1.40)、CMake 3.27.9。

从默认关闭组件开始，仅启用所列编解码/容器/滤镜；禁用线程、网络、硬件设备和自动依赖发现。Wasm 初始 32 MiB、最大线性内存 96 MiB。此上限不包括 JavaScript/MEMFS 等运行开销，不能替代整个 isolate 的内存验收。

`probe.c` 是本项目的输入检查和字形检查；它不提供任意 FFmpeg 命令接口。先检查 MP4 声明的编码/尺寸/时长，再进行有限探测；不能以这些检查替代不可信媒体的安全审计。当前服务仍仅限私有 P0 测试。

## 许可证与发布边界

启用 libx264 的链接核心按 GPL-2.0-or-later 记录；不能将整个 Wasm 声明为 MIT。FreeType 的许可文本、FFmpeg/x264/包装器的许可文本随构建归档；字体单独遵循 OFL。该清单是工程依赖记录，不等于已完成对外发行审查。

对外分发前，应一起准备与实际二进制对应的完整源码、这些构建脚本/补充 C 文件、配置和许可通知。目前不把 Wasm 二进制提交到 Git，也未向用户发布生产制作服务。

## 验证边界

编译成功只证明能够生成文件。必须用 `build:minimal` 后在 workerd 中重新跑媒体检查，不能复用通用核心的结果。动态字幕测试使用 common-CJK 字体（约 7.1 MiB），不宣称覆盖所有语言/Emoji。8 MiB 单文件实验输入限制仍在；规划的 100 MB 用户上传及前置转换尚未实现。
