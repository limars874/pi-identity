import { VERSION, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Type } from "typebox";

/**
 * pi-identity — 只读运行时身份快照。
 *
 * 回答“我是谁、在哪个会话、哪个目录、哪个 profile、当前挂的什么 provider/model”：
 * - `identity` 工具：供 agent 在运行时自查询（JSON 快照，进入 LLM 上下文）。
 * - `/identity` 命令：供用户在 TUI 手动查看（渲染为干净卡片，不进入 LLM 上下文）。
 *
 * 不包含任何模型管理（列表/切换）能力。
 */
export default function registerIdentityExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "identity",
    label: "Identity",
    description:
      "Report the active runtime identity of this Pi session: current provider and model, " +
      "thinking level, pi version and run mode, platform/arch, session id/file/dir, working " +
      "directory, agent directory, whether the session runs inside a (UPI-managed) container, " +
      "and any models scoped to this session. Takes no arguments.",
    promptSnippet:
      "identity() — report provider, model, thinking level, pi/runtime version, mode, session, cwd, and container/UPI sandbox status",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const snapshot = collectIdentity(ctx);
      return {
        content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }],
        details: snapshot,
      };
    },
  });

  // 自定义渲染器：把持久化的快照 entry 渲染成干净卡片。
  // entry 不进入 LLM 上下文；session 恢复后旧快照也会按当时数据重新渲染。
  pi.registerEntryRenderer<IdentitySnapshot>("identity", (entry, { expanded }, theme) => {
    const data = entry.data;
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));

    if (!data) {
      box.addChild(new Text(theme.fg("accent", "[identity]") + " no data", 0, 0));
      return box;
    }

    const modelLine = data.activeModel
      ? `${data.activeModel.provider}/${data.activeModel.id}`
      : "(no model)";
    const thinking = data.thinkingLevel ? ` · thinking ${data.thinkingLevel}` : "";
    box.addChild(
      new Text(`${theme.fg("accent", "[identity]")} ${theme.bold(modelLine)}${thinking}`, 0, 0),
    );

    const dim = (label: string, value: string) =>
      new Text(`${theme.fg("dim", label.padEnd(10))} ${value}`, 0, 0);
    // profile 是关键身份信息，非 default 时加粗突出；同行带上 agent 目录路径。
    const profile = data.runtime.profile;
    const profileText = profile === "default" ? profile : theme.bold(profile);
    box.addChild(dim("profile", `${profileText} · ${data.runtime.agentDir}`));
    box.addChild(dim("runtime", `pi ${data.runtime.piVersion} · ${data.runtime.mode} · ${data.runtime.platform}/${data.runtime.arch}`));
    // 容器行：宿主显示 host；在容器中时加粗突出（UPI daily/audit 或未知容器）。
    // 旧版本持久化的 entry 没有 container 字段，跳过该行。
    const container = data.container;
    if (container) {
      const containerText = !container.inContainer
        ? "host"
        : container.upi
          ? `${container.engine ?? "container"} · upi ${container.upi.kind ?? "managed"}${container.upi.name ? ` · ${container.upi.name}` : ""}`
          : `${container.engine ?? "container"} (unmanaged)`;
      box.addChild(dim("container", container.inContainer ? theme.bold(containerText) : containerText));
    }
    const sessionLabel = data.session.name ?? data.session.id;
    box.addChild(dim("session", sessionLabel));
    box.addChild(dim("cwd", data.cwd));
    if (data.scopedModels.length > 0) {
      box.addChild(dim("scoped", `${data.scopedModels.length} model(s)`));
    }

    // 展开时补充完整 JSON 细节，便于核对原始字段。
    if (expanded) {
      box.addChild(new Text(theme.fg("dim", JSON.stringify(data, null, 2)), 0, 0));
    }

    return box;
  });

  pi.registerCommand("identity", {
    description: "Show a clean snapshot of the current runtime identity",
    handler: async (_args, ctx) => {
      const snapshot = collectIdentity(ctx);
      if (ctx.mode === "tui") {
        pi.appendEntry<IdentitySnapshot>("identity", snapshot);
      } else {
        // 非交互模式没有 entry 渲染，直接输出 JSON。
        console.log(JSON.stringify(snapshot, null, 2));
      }
    },
  });
}

/** collectIdentity 返回值的类型，供 entry renderer 复用。 */
type IdentitySnapshot = ReturnType<typeof collectIdentity>;

/** 从 agent 目录推导 profile 名：默认目录为 default，否则取目录名（如 ~/.pi/profiles/piex → piex）。 */
function resolveProfile(agentDir: string): string {
  const defaultDir = join(homedir(), ".pi", "agent");
  return agentDir === defaultDir ? "default" : basename(agentDir);
}

/** 收集当前会话的运行时身份快照。 */
function collectIdentity(ctx: ExtensionContext) {
  const model = ctx.model;
  const sm = ctx.sessionManager;
  const agentDir = getAgentDir();

  return {
    activeModel: model
      ? {
          provider: model.provider,
          id: model.id,
          name: model.name,
          api: model.api,
          reasoning: model.reasoning,
          input: model.input,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          baseUrl: model.baseUrl,
        }
      : null,
    thinkingLevel: ctx.thinkingLevel ?? null,
    runtime: {
      piVersion: VERSION,
      mode: ctx.mode,
      platform: process.platform,
      arch: process.arch,
      agentDir,
      profile: resolveProfile(agentDir),
    },
    session: {
      id: sm.getSessionId(),
      file: sm.getSessionFile() ?? null,
      dir: sm.getSessionDir(),
      name: sm.getSessionName() ?? null,
      leafId: sm.getLeafId(),
    },
    cwd: ctx.cwd,
    // 容器/UPI 沙箱身份：宿主为 { inContainer: false }，容器内含 UPI 归属与 daily/audit 区分。
    container: collectContainer(ctx.cwd),
    // 当前会话的模型作用域。空数组表示未配置 scope（全部模型可用）。
    scopedModels: ctx.scopedModels.map((s) => ({
      provider: s.model.provider,
      id: s.model.id,
      pinnedThinkingLevel: s.thinkingLevel ?? null,
    })),
  };
}

/* ------------------------- 容器 / UPI 沙箱探测 ------------------------- */

/**
 * 容器身份探测结果。
 * 安全边界：只读环境变量与文件存在性；/run/upi-relay-token 只测存在、绝不读取内容；
 * 绝不输出 PI_RELAY_TOKEN 等任何凭据。
 */
export interface ContainerInfo {
  inContainer: boolean;
  engine: "docker" | "podman" | null;
  /** 非 UPI 管理的容器为 null。 */
  upi: {
    managed: boolean;
    /** daily = 项目日常容器；audit = 一次性审计容器。 */
    kind: "daily" | "audit" | null;
    name: string | null;
    /** 仅 daily 可从项目 .pi-container/metadata.json 获得。 */
    image: string | null;
    relayUrl: string | null;
    /** marker = UPI 显式标记（契约）；heuristic = 环境/文件启发式兜底。 */
    detection: "marker" | "heuristic";
  } | null;
}

/** 文件系统探针，注入以便离线测试；生产默认真实 fs。 */
export interface ContainerProbes {
  exists(path: string): boolean;
  read(path: string): string | null;
}

const fsProbes: ContainerProbes = {
  exists: (p) => existsSync(p),
  read: (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
};

/** UPI relay token 在容器 tmpfs 的固定路径（只测存在性，不读内容）。 */
const UPI_RELAY_TOKEN_FILE = "/run/upi-relay-token";

/** 通用容器运行时探测：/.dockerenv 或 cgroup 签名。 */
function detectContainerEngine(probes: ContainerProbes): ContainerInfo["engine"] {
  if (probes.exists("/.dockerenv")) return "docker";
  const cgroup = probes.read("/proc/self/cgroup");
  if (cgroup) {
    if (/docker|containerd/i.test(cgroup)) return "docker";
    if (/libpod|podman/i.test(cgroup)) return "podman";
  }
  return null;
}

/** UPI daily 容器在项目根写入的绑定信息（项目目录同路径 bind mount，容器内可读）。 */
interface UpiContainerMetadata {
  containerName: string;
  image: string | null;
}

/** 从 startDir 向上查找 .pi-container/metadata.json；限深防止极端目录。 */
function findUpiContainerMetadata(
  startDir: string,
  probes: ContainerProbes,
): UpiContainerMetadata | null {
  let dir = startDir;
  for (let depth = 0; depth < 16; depth++) {
    const raw = probes.read(join(dir, ".pi-container", "metadata.json"));
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          const record = parsed as Record<string, unknown>;
          if (typeof record.containerName === "string") {
            return {
              containerName: record.containerName,
              image: typeof record.image === "string" ? record.image : null,
            };
          }
        }
      } catch {
        /* 损坏的 metadata 视为无 */
      }
      // 找到过项目根但解析失败，不再继续向上。
      return null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * 探测当前进程是否运行在（UPI 管理的）容器中。
 *
 * 判定优先级：
 * 1. UPI 显式标记：UPI_CONTAINER=1（+ UPI_CONTAINER_KIND=daily|audit / UPI_CONTAINER_NAME），
 *    由 upi 在 docker exec 层注入，契约归 UPI 所有；
 * 2. 启发式兜底：/.dockerenv、cgroup 签名、PI_RELAY_URL、PI_RELAY_CLIENT_ID（audit- 前缀）、
 *    relay token 文件存在性、从 cwd 向上的 .pi-container/metadata.json。
 */
export function collectContainer(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  probes: ContainerProbes = fsProbes,
): ContainerInfo {
  // 先提为局部常量：ProcessEnv 索引签名访问不参与控制流收窄。
  const kindEnv = env.UPI_CONTAINER_KIND;
  const markerKind = kindEnv === "daily" || kindEnv === "audit" ? kindEnv : null;
  const marker: { kind: "daily" | "audit" | null; name: string | null } | null =
    env.UPI_CONTAINER === "1"
      ? { kind: markerKind, name: env.UPI_CONTAINER_NAME || null }
      : null;

  const engine = detectContainerEngine(probes);
  if (marker === null && engine === null) {
    return { inContainer: false, engine: null, upi: null };
  }

  const relayUrl = env.PI_RELAY_URL || null;
  const relayClientId = env.PI_RELAY_CLIENT_ID || null;
  const hasRelayTokenFile = probes.exists(UPI_RELAY_TOKEN_FILE);
  const upiManaged = marker !== null || relayUrl !== null || hasRelayTokenFile;
  if (!upiManaged) {
    return { inContainer: true, engine: engine ?? "docker", upi: null };
  }

  // audit 的 workspace 是独立 volume，没有项目根的 metadata；daily 有。
  const metadata = findUpiContainerMetadata(cwd, probes);
  // 显式标注防止 let 声明把字面量联合拓宽成 string。
  let kind: "daily" | "audit" | null = marker?.kind ?? null;
  if (!kind) {
    if (relayClientId?.startsWith("audit-")) {
      kind = "audit";
    } else if (metadata || env.MISE_CACHE_DIR || hasRelayTokenFile) {
      kind = "daily";
    }
  }

  return {
    inContainer: true,
    engine: engine ?? "docker",
    upi: {
      managed: true,
      kind,
      // 显式标记的名字优先；否则 daily 用 metadata 的 containerName，audit 无从得知为 null。
      name: marker?.name ?? metadata?.containerName ?? null,
      image: metadata?.image ?? null,
      relayUrl,
      detection: marker ? "marker" : "heuristic",
    },
  };
}
