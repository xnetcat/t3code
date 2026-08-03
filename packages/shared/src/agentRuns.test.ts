import { describe, expect, it } from "vite-plus/test";

import {
  activeAgentRuns,
  deriveAgentRuns,
  formatAgentRunDuration,
  formatAgentRunTokenCount,
} from "./agentRuns.ts";

describe("deriveAgentRuns", () => {
  it("builds a Claude-style run from task.* activities", () => {
    const runs = deriveAgentRuns([
      {
        id: "a1",
        createdAt: "2026-08-03T20:00:00.000Z",
        kind: "task.started",
        summary: "Task started",
        turnId: "turn-1",
        payload: {
          taskId: "task-1",
          taskType: "Workflow",
          detail: "example-workflow",
        },
      },
      {
        id: "a2",
        createdAt: "2026-08-03T20:00:06.000Z",
        kind: "task.progress",
        summary: "Surveying",
        turnId: "turn-1",
        payload: {
          taskId: "task-1",
          summary: "surveying frontend",
          lastToolName: "Read",
          usage: { total_tokens: 28_000 },
        },
      },
      {
        id: "a3",
        createdAt: "2026-08-03T20:00:12.000Z",
        kind: "task.completed",
        summary: "Task completed",
        turnId: "turn-1",
        payload: {
          taskId: "task-1",
          status: "completed",
          summary: "Done",
          usage: { total_tokens: 75_000 },
        },
      },
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: "task-1",
      title: "example-workflow",
      taskType: "Workflow",
      status: "completed",
      usageTokens: 75_000,
      summary: "Done",
    });
    expect(runs[0]?.agents.length).toBeGreaterThan(0);
  });

  it("builds a Codex-style run from collab agentsStates", () => {
    const runs = deriveAgentRuns([
      {
        id: "c1",
        createdAt: "2026-08-03T20:00:00.000Z",
        kind: "tool.started",
        summary: "Subagent task",
        turnId: "turn-2",
        payload: {
          itemType: "collab_agent_tool_call",
          status: "inProgress",
          title: "spawn agents",
          data: {
            item: {
              id: "collab-1",
              type: "collabAgentToolCall",
              receiverThreadIds: ["agent-a", "agent-b"],
              agentsStates: {
                "agent-a": { status: "inProgress", message: "survey:frontend" },
                "agent-b": { status: "completed", message: "survey:backend" },
              },
            },
          },
        },
      },
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.id).toBe("collab-1");
    expect(runs[0]?.agents).toHaveLength(2);
    expect(runs[0]?.agents.map((agent) => agent.name).sort()).toEqual([
      "survey:backend",
      "survey:frontend",
    ]);
    expect(activeAgentRuns(runs)).toHaveLength(1);
  });

  it("treats OpenCode/ACP collab tool rows as single-agent runs", () => {
    const runs = deriveAgentRuns([
      {
        id: "o1",
        createdAt: "2026-08-03T20:00:00.000Z",
        kind: "tool.updated",
        summary: "task",
        payload: {
          itemType: "collab_agent_tool_call",
          status: "inProgress",
          title: "explore (subagent)",
          data: { tool: "task", callID: "call-9" },
        },
      },
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("running");
    expect(runs[0]?.title).toContain("explore");
  });
});

describe("format helpers", () => {
  it("formats durations and token counts", () => {
    expect(
      formatAgentRunDuration(
        {
          startedAt: "2026-08-03T20:00:00.000Z",
          updatedAt: "2026-08-03T20:00:12.000Z",
          status: "completed",
        },
        Date.parse("2026-08-03T20:01:00.000Z"),
      ),
    ).toBe("12s");

    expect(formatAgentRunTokenCount(750)).toBe("750");
    expect(formatAgentRunTokenCount(28_000)).toBe("28K");
    expect(formatAgentRunTokenCount(undefined)).toBeUndefined();
  });
});
