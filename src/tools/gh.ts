import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

// Helper to define tools with proper parameter type inference
function defineTool<
  TParams extends ReturnType<typeof Type.Object>,
>(
  def: {
    name: string;
    label: string;
    description: string;
    parameters: TParams;
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal?: AbortSignal,
      onUpdate?: (result: { content: { type: "text"; text: string }[]; details: unknown }) => void,
    ) => Promise<{ content: { type: "text"; text: string }[]; details: unknown }>;
  },
): AgentTool {
  return def as unknown as AgentTool;
}

/**
 * List GitHub Issues assigned to the user or authored by them.
 */
export const ghListIssues = defineTool({
  name: "gh_list_issues",
  label: "List GitHub Issues",
  description: "List your GitHub Issues (assigned or authored). Uses `gh` CLI.",
  parameters: Type.Object({
    scope: Type.Optional(
      Type.Union(
        [Type.Literal("assigned"), Type.Literal("authored"), Type.Literal("all")],
        { description: "Scope of issues to list" },
      ),
    ),
    state: Type.Optional(
      Type.Union(
        [Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")],
        { description: "Issue state filter" },
      ),
    ),
    limit: Type.Optional(Type.Number({ description: "Max results", default: 10 })),
  }),
  execute: async (_toolCallId, params) => {
    const scope = (params.scope as string) ?? "assigned";
    const state = (params.state as string) ?? "open";
    const limit = (params.limit as number) ?? 10;

    // TODO: implement real gh CLI integration
    const result = `[stub] gh_list_issues(scope=${scope}, state=${state}, limit=${limit})`;
    return {
      content: [{ type: "text", text: result }],
      details: { scope, state, limit },
    };
  },
});

/**
 * List GitHub Pull Requests authored by the user.
 */
export const ghListPrs = defineTool({
  name: "gh_list_prs",
  label: "List GitHub PRs",
  description: "List your open GitHub Pull Requests. Uses `gh` CLI.",
  parameters: Type.Object({
    state: Type.Optional(
      Type.Union(
        [Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")],
        { description: "PR state filter" },
      ),
    ),
    limit: Type.Optional(Type.Number({ description: "Max results", default: 10 })),
  }),
  execute: async (_toolCallId, params) => {
    const state = (params.state as string) ?? "open";
    const limit = (params.limit as number) ?? 10;

    // TODO: implement real gh CLI integration
    const result = `[stub] gh_list_prs(state=${state}, limit=${limit})`;
    return {
      content: [{ type: "text", text: result }],
      details: { state, limit },
    };
  },
});
