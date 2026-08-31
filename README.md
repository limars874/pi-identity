# pi-identity

只读的运行时身份快照扩展。让 agent 在运行时自查询“我是谁、在哪个会话、哪个目录、哪个 profile、什么 pi 版本/环境、当前挂的 provider/model”。

## 设计边界

`pi-identity` 只做**只读快照**，不做模型管理。模型空间（可用清单 / 切换）属于另一个独立扩展，避免职责耦合。

## 工具

### `identity`

无参数。返回 JSON：

```json
{
  "activeModel": {
    "provider": "dodo",
    "id": "deepseek-v4-flash-0731",
    "name": "...",
    "api": "openai-completions",
    "reasoning": true,
    "input": ["text", "image"],
    "contextWindow": 131072,
    "maxTokens": 32768,
    "baseUrl": "https://tokendodo.ai/v1"
  },
  "thinkingLevel": "high",
  "runtime": {
    "piVersion": "0.84.2",
    "mode": "tui",
    "platform": "darwin",
    "arch": "arm64",
    "agentDir": "/Users/yi/.pi/agent",
    "profile": "default"
  },
  "session": {
    "id": "...",
    "file": "...",
    "dir": "...",
    "name": "...",
    "leafId": "..."
  },
  "cwd": "/path/to/project",
  "container": {
    "inContainer": true,
    "engine": "docker",
    "upi": {
      "managed": true,
      "kind": "daily",
      "name": "pi-dev-1a2b3c4d5e6f",
      "image": "pi-dev:0.84.2",
      "relayUrl": "http://host.docker.internal:7788",
      "detection": "marker"
    }
  },
  "scopedModels": []
}
```

字段说明：

| 字段 | 含义 |
|------|------|
| `activeModel` | 当前激活模型（元信息，不含凭据，含 `input` 支持的输入类型）；未加载模型时为 `null` |
| `thinkingLevel` | 当前有效思考级别；未提供时为 `null` |
| `runtime` | pi 版本 / 运行模式（tui/rpc/json/print）/ 平台 / 架构 / agent 目录 / profile 名 |
| `session` | 会话 id / 会话文件路径 / 会话目录 / 显示名 / 当前 leaf 条目 |
| `cwd` | 当前工作目录 |
| `container` | 容器沙箱身份：`inContainer` 是否在容器中、`engine` 容器运行时、`upi` UPI 归属（见下）；宿主上为 `{ "inContainer": false, "engine": null, "upi": null }` |
| `scopedModels` | 当前会话的模型作用域（`--models` 或 `enabledModels` 决定）；空数组 = 未限制，全部模型可用 |

`container.upi` 仅在 UPI 管理的容器内非空：

| 字段 | 含义 |
|------|------|
| `kind` | `daily`（项目日常容器）或 `audit`（一次性审计容器）；无法判定时为 `null` |
| `name` | 容器名（显式标记或 `.pi-container/metadata.json`）；audit 启发式路径下不可得为 `null` |
| `image` | 容器镜像（仅 daily 的 metadata 提供） |
| `relayUrl` | 容器内 relay 端点（`PI_RELAY_URL`） |
| `detection` | `marker` = 读取 UPI 显式标记（`UPI_CONTAINER_*`，契约归 UPI）；`heuristic` = 环境/文件启发式兜底 |

**安全边界**：容器探测只读环境变量与文件存在性；`/run/upi-relay-token` 只测存在、绝不读取内容；不输出 `PI_RELAY_TOKEN` 等任何凭据。

`profile` 从 agent 目录推导：`~/.pi/agent` 为 `default`，`~/.pi/profiles/<name>` 等自定义 `PI_CODING_AGENT_DIR` 取目录名（如 `piex`）。

## 命令

### `/identity`

供用户在 TUI 手动查看身份快照。复用与工具相同的数据收集逻辑，但以主题色卡片渲染在聊天记录中：折叠时显示模型 / thinking 级别 / profile（含 agent 目录路径）/ 运行时 / 会话 / cwd 等关键行，展开（Ctrl+O）时附带完整 JSON 细节。

与工具的关键区别：卡片通过 `pi.appendEntry` + `pi.registerEntryRenderer` 实现，**不进入 LLM 上下文**（不会消耗 token，也不会干扰对话）；非 TUI 模式下退化为向 stdout 打印 JSON。

折叠态包含一行容器状态：宿主显示 `host`；容器内显示如 `docker · upi daily · pi-dev-1a2b3c4d5e6f`（加粗突出）。

## 安装

```bash
# git 包
pi install git:github.com/<you>/pi-identity

# 本地路径
pi install /Users/yi/Documents/code/temp/pi-projects/pi-identity

# 临时试用（不落地到 settings）
pi -e /Users/yi/Documents/code/temp/pi-projects/pi-identity/src/extension.ts
```

## 开发

```bash
npm install
npm run typecheck
```

- 扩展入口：`src/extension.ts`（默认导出工厂函数）。
- 依赖 `typebox` 定义无参数 schema；`@earendil-works/pi-coding-agent` 的类型与 `VERSION` / `getAgentDir` 运行时导出、`@earendil-works/pi-tui` 的 `Box` / `Text` 组件均由 pi 在加载时注入（peerDependency）。