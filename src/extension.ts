import { VERSION, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/**
 * pi-identity — 只读运行时身份快照。
 *
 * 回答“我是谁、在哪个会话、哪个目录、哪个 profile、当前挂的什么 provider/model”，
 * 供 agent 在运行时自查询。不包含任何模型管理（列表/切换）能力。
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
}

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