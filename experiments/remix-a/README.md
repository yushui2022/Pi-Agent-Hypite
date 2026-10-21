# A 路线（生成式重做）核实与调用清单（2026-10-20）

用户确认走 A：**把爆款视频里的人或商品换成用户的，动作与节奏照搬原作**。本目录记录这条路线在 Hypit 源码里的真实位置，以及本机实测数据。

成本不作为约束（用户已明确）。本目录关心的是**结构对不对、调用有多少次**。

## 结论：A 是 Hypit 的原生模式，不是我们拼出来的

| 证据 | 位置 |
|---|---|
| `seedance:ReferenceVideo` 支持图片/视频/音频参考 | `vendor/hypit/docs/quickstart/generation.md` |
| 官方原话：**视频参考负责动作与镜头运动，图片参考负责新外观** | 同上，`ReferenceVideo` 一节 |
| 每个图片/视频参考必须显式声明 `person-reference`，漏写即报错 | `vendor/hypit/packages/seedance/README.md` |
| 官方示例直接提供 `swap-host`（换人）/ `swap-item`（换商品）/ `swap-app` 变体 | `vendor/hypit/examples/{podcast,interview,ranking-football}/` |

对照结论：B 路线（抠像合成）**没有原生能力**。`@hypit/volcengine-matting` 的用途是"去掉动态人像背景，把人的剪影放到另一张图上"，方向与"保留背景、换掉人"相反。

## 本机实测：check 与 plan 真实通过

`check` 是编辑期检查，`plan` 输出完整执行计划，两者都不会提交生成。

```powershell
node experiments/remix-a/inventory.mjs vendor/hypit/examples/podcast swap-item.svrun
node experiments/remix-a/inventory.mjs vendor/hypit/examples/interview swap-host.svrun
```

实测结果：

| 工程 | 计划步骤 | 付费模型调用 | 构成 |
|---|---|---|---|
| 换商品 `podcast/swap-item` | 32 | **13** | 9 次 `gpt-image-2` 生图 + 4 次 `seedance-2-mini` 生视频 |
| 换人 `interview/swap-host` | 29 | **10** | 7 次 `gpt-image-2` 生图 + 3 次 `seedance-2-mini` 生视频 |

其余步骤是本地媒体操作（`inspect-media`、`normalize-media`、`mux-program-media`、`render-timeline-audio`）、本地或服务的转写对齐（`whisperx-alignment`）与最终渲染（`render-hyperframes`）。

**一条 15 秒左右的成片，结构上就是约 10–13 次付费模型调用**，与"1 command 100 variants"相乘即得批次量级。单价需按选定供应商报价，本目录不估算。

## 这条路线与自研 Workers 引擎的分工

必须分清，别把两件事混成一件：

- **换人/换商品发生在生成模型**（Seedance / GPT-Image / PixVerse 等），不在自研 Wasm 引擎里。自研引擎没有、也不该有这项能力。
- **自研 Workers 引擎负责最后一段**：归一化、字幕烧录、音轨混合、合成成片。这是 `docs/local-execution-core.md` 已本地验证的部分。
- 因此 `docs/workers-execution-plan.md` 的 P0 关口对 A 路线**只覆盖尾段**。换人效果好不好，取决于生成模型的质量与参考图质量，与 Workers 编码能力无关。

## 尚未验证
1. 真实营销爆款视频的**分析**（谁能时间码级看懂视频）——当前无模型凭证，未做
2. 真实**生成**（要供应商密钥与付费），未做
3. 生成画面与原作在**节奏、构图、文字位置**上的一致性——未做
4. 音色参考（`audio` reference）与口型一致性——未做

## 输入真实视频后 agent 要做的事

1. 拆镜头：按切点得到分段，记录每段时长、构图、动作、屏上文字
2. 建工程：每段一个 `seedance:ReferenceVideo`，原片对应片段作视频参考，用户的商品/人像图作图片参考（`person-reference` 按材料实际内容填 true/false）
3. 写字幕与脚本：与原片的语义锚点对齐，不要按秒硬塞
4. `check` 通过 → `plan` 核对调用清单与成本结构
5. 确认后才 `build`（唯一会提交生成并产生费用的命令）

## 边界

- 本目录只做只读检查与统计，**没有执行过任何 build**，没有调用任何生成模型，没有任何费用产生。
- `inventory.mjs` 的能力归类是启发式的（按包名匹配），未识别的项以 `other` 原样列出，不做猜测性归并。
