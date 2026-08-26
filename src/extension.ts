import { VERSION, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
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
      "directory, agent directory, and any models scoped to this session. Takes no arguments.",
    promptSnippet:
      "identity() — report provider, model, thinking level, pi/runtime version, mode, session, and cwd",
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
      new Text(`${theme.fg("dim", label.padEnd(8))} ${value}`, 0, 0);
    box.addChild(dim("runtime", `pi ${data.runtime.piVersion} · ${data.runtime.mode} · ${data.runtime.platform}/${data.runtime.arch}`));
    const sessionLabel = data.session.name ?? data.session.id;
    box.addChild(dim("session", sessionLabel));
    box.addChild(dim("cwd", data.cwd));
    box.addChild(dim("agent", data.runtime.agentDir));
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

/** 收集当前会话的运行时身份快照。 */
function collectIdentity(ctx: ExtensionContext) {
  const model = ctx.model;
  const sm = ctx.sessionManager;

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
      agentDir: getAgentDir(),
    },
    session: {
      id: sm.getSessionId(),
      file: sm.getSessionFile() ?? null,
      dir: sm.getSessionDir(),
      name: sm.getSessionName() ?? null,
      leafId: sm.getLeafId(),
    },
    cwd: ctx.cwd,
    // 当前会话的模型作用域。空数组表示未配置 scope（全部模型可用）。
    scopedModels: ctx.scopedModels.map((s) => ({
      provider: s.model.provider,
      id: s.model.id,
      pinnedThinkingLevel: s.thinkingLevel ?? null,
    })),
  };
}
