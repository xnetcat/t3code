/**
 * Cross-provider AgentRun derivation.
 *
 * Providers emit different subagent signals:
 * - Claude: `task.*` + `collab_agent_tool_call`
 * - Codex: `collab_agent_tool_call` (agentsStates / receiverThreadIds) + `subAgentActivity`
 * - OpenCode: `collab_agent_tool_call` (Task tool); child session work when ingested
 * - Cursor / Grok (ACP): agent-like tool calls mapped to `collab_agent_tool_call`
 *
 * This module normalizes orchestration activities into a single AgentRun tree for UI.
 */

export type AgentRunStatus = "running" | "completed" | "failed" | "stopped";

export type AgentRunAgentStatus = AgentRunStatus | "pending";

export interface AgentRunAgent {
  readonly id: string;
  readonly name: string;
  readonly status: AgentRunAgentStatus;
  readonly tokens?: number;
  readonly lastToolName?: string;
  readonly summary?: string;
  readonly startedAt?: string;
  readonly updatedAt?: string;
  readonly workActivityIds: ReadonlyArray<string>;
}

export interface AgentRun {
  readonly id: string;
  readonly title: string;
  readonly taskType?: string;
  readonly status: AgentRunStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly turnId?: string | null;
  readonly agents: ReadonlyArray<AgentRunAgent>;
  readonly summary?: string;
  readonly usageTokens?: number;
  /** Activity ids that constitute this run (task.* + collab tool rows). */
  readonly sourceActivityIds: ReadonlyArray<string>;
  /** Work-log / tool activity ids nested under this run (for detail panels). */
  readonly workActivityIds: ReadonlyArray<string>;
}

export interface AgentRunActivityInput {
  readonly id: string;
  readonly createdAt: string;
  readonly kind: string;
  readonly summary: string;
  readonly tone?: string;
  readonly turnId?: string | null;
  readonly payload?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function extractTaskId(payload: Record<string, unknown> | undefined): string | undefined {
  return asTrimmedString(payload?.taskId) ?? asTrimmedString(payload?.task_id);
}

function extractToolCallId(payload: Record<string, unknown> | undefined): string | undefined {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item) ?? asRecord(payload?.item);
  return (
    asTrimmedString(payload?.toolCallId) ??
    asTrimmedString(payload?.itemId) ??
    asTrimmedString(item?.id) ??
    asTrimmedString(data?.toolCallId) ??
    asTrimmedString(data?.callID) ??
    asTrimmedString(data?.id)
  );
}

function extractItemType(payload: Record<string, unknown> | undefined): string | undefined {
  return asTrimmedString(payload?.itemType) ?? asTrimmedString(payload?.item_type);
}

function extractUsageTokens(usage: unknown): number | undefined {
  const record = asRecord(usage);
  if (!record) {
    return undefined;
  }
  return (
    asNumber(record.total_tokens) ??
    asNumber(record.totalTokens) ??
    asNumber(record.input_tokens) ??
    asNumber(record.inputTokens) ??
    asNumber(record.tokens)
  );
}

function mapToolStatus(status: string | undefined): AgentRunStatus | undefined {
  switch (status) {
    case "inProgress":
    case "pending":
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "stopped":
    case "cancelled":
    case "interrupted":
      return "stopped";
    default:
      return undefined;
  }
}

function mapTaskCompletedStatus(status: string | undefined): AgentRunStatus {
  switch (status) {
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
    default:
      return "completed";
  }
}

function isCollabAgentActivity(
  activity: AgentRunActivityInput,
  payload: Record<string, unknown> | undefined,
): boolean {
  if (extractItemType(payload) === "collab_agent_tool_call") {
    return true;
  }
  if (activity.kind === "subagent.activity") {
    return true;
  }
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const itemType = asTrimmedString(item?.type)?.toLowerCase();
  if (itemType === "collabagenttoolcall" || itemType === "subagentactivity") {
    return true;
  }
  return false;
}

function extractCodexAgents(
  payload: Record<string, unknown> | undefined,
  activityId: string,
  createdAt: string,
): AgentRunAgent[] {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item) ?? asRecord(payload?.item);
  const agentsStates = asRecord(item?.agentsStates) ?? asRecord(data?.agentsStates);
  if (!agentsStates) {
    const receiverIds = item?.receiverThreadIds;
    if (Array.isArray(receiverIds) && receiverIds.length > 0) {
      return receiverIds.flatMap((entry, index) => {
        const id = asTrimmedString(entry);
        if (!id) return [];
        return [
          {
            id,
            name: `agent-${index + 1}`,
            status: "running" as const,
            startedAt: createdAt,
            updatedAt: createdAt,
            workActivityIds: [] as string[],
          },
        ];
      });
    }
    return [];
  }

  return Object.entries(agentsStates).flatMap(([agentId, stateValue]) => {
    const state = asRecord(stateValue);
    const status = mapToolStatus(asTrimmedString(state?.status)) ?? "running";
    const message = asTrimmedString(state?.message);
    return [
      {
        id: agentId,
        name: message ? truncate(message, 48) : shortAgentName(agentId),
        status:
          status === "completed" || status === "failed" || status === "stopped"
            ? status
            : "running",
        ...(message ? { summary: message } : {}),
        startedAt: createdAt,
        updatedAt: createdAt,
        workActivityIds: [activityId],
      },
    ];
  });
}

function extractSubagentActivityAgent(
  payload: Record<string, unknown> | undefined,
  activityId: string,
  createdAt: string,
): AgentRunAgent | undefined {
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item) ?? asRecord(payload?.item);
  const agentThreadId =
    asTrimmedString(item?.agentThreadId) ?? asTrimmedString(data?.agentThreadId);
  if (!agentThreadId) {
    return undefined;
  }
  const kind = asTrimmedString(item?.kind) ?? asTrimmedString(data?.kind);
  const agentPath = asTrimmedString(item?.agentPath) ?? asTrimmedString(data?.agentPath);
  const status: AgentRunAgentStatus =
    kind === "interrupted" ? "stopped" : kind === "interacted" ? "running" : "running";
  return {
    id: agentThreadId,
    name: agentPath ? shortAgentName(agentPath) : shortAgentName(agentThreadId),
    status,
    startedAt: createdAt,
    updatedAt: createdAt,
    workActivityIds: [activityId],
  };
}

function shortAgentName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 28) {
    return trimmed;
  }
  const parts = trimmed.split(/[/:]/u).filter(Boolean);
  const last = parts[parts.length - 1] ?? trimmed;
  return last.length <= 28 ? last : `${last.slice(0, 25)}…`;
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

function titleFromCollabPayload(
  activity: AgentRunActivityInput,
  payload: Record<string, unknown> | undefined,
): string {
  const titled =
    asTrimmedString(payload?.title) ??
    asTrimmedString(payload?.summary) ??
    asTrimmedString(payload?.detail);
  if (titled) {
    return truncate(titled, 80);
  }
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const prompt = asTrimmedString(item?.prompt) ?? asTrimmedString(data?.prompt);
  if (prompt) {
    return truncate(prompt, 80);
  }
  const tool = asTrimmedString(data?.tool);
  if (tool) {
    return truncate(tool, 80);
  }
  return truncate(activity.summary || "Subagent", 80);
}

interface MutableAgent {
  id: string;
  name: string;
  status: AgentRunAgentStatus;
  tokens?: number;
  lastToolName?: string;
  summary?: string;
  startedAt?: string;
  updatedAt?: string;
  workActivityIds: string[];
}

interface MutableRun {
  id: string;
  title: string;
  taskType?: string;
  status: AgentRunStatus;
  startedAt: string;
  updatedAt: string;
  turnId?: string | null;
  agents: Map<string, MutableAgent>;
  summary?: string;
  usageTokens?: number;
  sourceActivityIds: string[];
  workActivityIds: string[];
}

function ensureAgent(run: MutableRun, agent: AgentRunAgent): void {
  const existing = run.agents.get(agent.id);
  if (!existing) {
    run.agents.set(agent.id, {
      ...agent,
      workActivityIds: [...agent.workActivityIds],
    });
    return;
  }
  existing.name = agent.name || existing.name;
  existing.status = agent.status;
  if (agent.tokens !== undefined) existing.tokens = agent.tokens;
  if (agent.lastToolName) existing.lastToolName = agent.lastToolName;
  if (agent.summary) existing.summary = agent.summary;
  if (agent.startedAt && (!existing.startedAt || agent.startedAt < existing.startedAt)) {
    existing.startedAt = agent.startedAt;
  }
  if (agent.updatedAt) existing.updatedAt = agent.updatedAt;
  for (const workId of agent.workActivityIds) {
    if (!existing.workActivityIds.includes(workId)) {
      existing.workActivityIds.push(workId);
    }
  }
}

function upsertRun(
  runs: Map<string, MutableRun>,
  next: Omit<MutableRun, "agents"> & { agents?: AgentRunAgent[] },
): MutableRun {
  const existing = runs.get(next.id);
  if (!existing) {
    const created: MutableRun = {
      ...next,
      agents: new Map(),
      sourceActivityIds: [...next.sourceActivityIds],
      workActivityIds: [...next.workActivityIds],
    };
    for (const agent of next.agents ?? []) {
      ensureAgent(created, agent);
    }
    runs.set(next.id, created);
    return created;
  }

  existing.title = next.title || existing.title;
  existing.status = next.status;
  if (next.taskType) existing.taskType = next.taskType;
  if (next.summary) existing.summary = next.summary;
  if (next.usageTokens !== undefined) existing.usageTokens = next.usageTokens;
  if (next.turnId !== undefined) existing.turnId = next.turnId;
  if (next.startedAt < existing.startedAt) existing.startedAt = next.startedAt;
  if (next.updatedAt > existing.updatedAt) existing.updatedAt = next.updatedAt;
  for (const id of next.sourceActivityIds) {
    if (!existing.sourceActivityIds.includes(id)) existing.sourceActivityIds.push(id);
  }
  for (const id of next.workActivityIds) {
    if (!existing.workActivityIds.includes(id)) existing.workActivityIds.push(id);
  }
  for (const agent of next.agents ?? []) {
    ensureAgent(existing, agent);
  }
  return existing;
}

function freezeRun(run: MutableRun): AgentRun {
  const agents = [...run.agents.values()]
    .map(
      (agent): AgentRunAgent => ({
        id: agent.id,
        name: agent.name,
        status: agent.status,
        ...(agent.tokens !== undefined ? { tokens: agent.tokens } : {}),
        ...(agent.lastToolName ? { lastToolName: agent.lastToolName } : {}),
        ...(agent.summary ? { summary: agent.summary } : {}),
        ...(agent.startedAt ? { startedAt: agent.startedAt } : {}),
        ...(agent.updatedAt ? { updatedAt: agent.updatedAt } : {}),
        workActivityIds: [...agent.workActivityIds],
      }),
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    id: run.id,
    title: run.title,
    ...(run.taskType ? { taskType: run.taskType } : {}),
    status: run.status,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    ...(run.turnId !== undefined ? { turnId: run.turnId } : {}),
    agents,
    ...(run.summary ? { summary: run.summary } : {}),
    ...(run.usageTokens !== undefined ? { usageTokens: run.usageTokens } : {}),
    sourceActivityIds: [...run.sourceActivityIds],
    workActivityIds: [...run.workActivityIds],
  };
}

/**
 * Derive AgentRun records from orchestration activities (provider-agnostic).
 * Later activities win for status/title/summary when they share an id.
 */
export function deriveAgentRuns(
  activities: ReadonlyArray<AgentRunActivityInput>,
): ReadonlyArray<AgentRun> {
  const runs = new Map<string, MutableRun>();
  const turnCollabIds = new Map<string, string[]>();

  for (const activity of activities) {
    const payload = asRecord(activity.payload);
    const turnKey = activity.turnId ?? "";

    if (
      activity.kind === "task.started" ||
      activity.kind === "task.progress" ||
      activity.kind === "task.completed"
    ) {
      const taskId = extractTaskId(payload);
      if (!taskId) continue;

      const description =
        asTrimmedString(payload?.detail) ??
        asTrimmedString(payload?.title) ??
        asTrimmedString(payload?.description) ??
        asTrimmedString(payload?.summary) ??
        activity.summary;
      const status: AgentRunStatus =
        activity.kind === "task.completed"
          ? mapTaskCompletedStatus(asTrimmedString(payload?.status))
          : "running";
      const usageTokens = extractUsageTokens(payload?.usage);
      const lastToolName = asTrimmedString(payload?.lastToolName);
      const agents: AgentRunAgent[] = [];
      if (lastToolName) {
        agents.push({
          id: `${taskId}:latest-tool`,
          name: lastToolName,
          status: status === "running" ? "running" : status,
          ...(usageTokens !== undefined ? { tokens: usageTokens } : {}),
          updatedAt: activity.createdAt,
          workActivityIds: [activity.id],
        });
      }

      upsertRun(runs, {
        id: taskId,
        title: truncate(description || "Background task", 80),
        taskType: asTrimmedString(payload?.taskType),
        status,
        startedAt: activity.createdAt,
        updatedAt: activity.createdAt,
        turnId: activity.turnId,
        summary: asTrimmedString(payload?.summary) ?? asTrimmedString(payload?.detail),
        usageTokens,
        sourceActivityIds: [activity.id],
        workActivityIds: activity.kind === "task.started" ? [] : [activity.id],
        agents,
      });
      continue;
    }

    if (!isCollabAgentActivity(activity, payload)) {
      continue;
    }

    const toolCallId = extractToolCallId(payload) ?? activity.id;
    const status =
      mapToolStatus(asTrimmedString(payload?.status)) ??
      (activity.tone === "error"
        ? "failed"
        : activity.kind === "tool.completed"
          ? "completed"
          : "running");

    const codexAgents = extractCodexAgents(payload, activity.id, activity.createdAt);
    const subagent = extractSubagentActivityAgent(payload, activity.id, activity.createdAt);
    const agents = [...codexAgents];
    if (subagent) {
      agents.push(subagent);
    }
    if (agents.length === 0) {
      agents.push({
        id: toolCallId,
        name: titleFromCollabPayload(activity, payload),
        status:
          status === "completed" || status === "failed" || status === "stopped"
            ? status
            : "running",
        startedAt: activity.createdAt,
        updatedAt: activity.createdAt,
        workActivityIds: [activity.id],
      });
    }

    // Prefer linking a collab tool call onto an existing task.* run in the same turn.
    const turnRuns = turnKey
      ? [...runs.values()].filter(
          (run) => run.turnId === activity.turnId && run.status === "running",
        )
      : [];
    const linkedTaskId = turnRuns.length === 1 ? turnRuns[0]!.id : undefined;
    const runId = linkedTaskId ?? toolCallId;

    if (turnKey) {
      const list = turnCollabIds.get(turnKey) ?? [];
      if (!list.includes(runId)) {
        list.push(runId);
        turnCollabIds.set(turnKey, list);
      }
    }

    upsertRun(runs, {
      id: runId,
      title: titleFromCollabPayload(activity, payload),
      status,
      startedAt: activity.createdAt,
      updatedAt: activity.createdAt,
      turnId: activity.turnId,
      summary: asTrimmedString(payload?.detail) ?? asTrimmedString(payload?.summary),
      sourceActivityIds: [activity.id],
      workActivityIds: [activity.id],
      agents,
    });
  }

  return [...runs.values()]
    .map(freezeRun)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function activeAgentRuns(runs: ReadonlyArray<AgentRun>): ReadonlyArray<AgentRun> {
  return runs.filter((run) => run.status === "running");
}

export function formatAgentRunDuration(
  run: Pick<AgentRun, "startedAt" | "updatedAt" | "status">,
  nowMs: number = Date.now(),
): string {
  const start = Date.parse(run.startedAt);
  if (!Number.isFinite(start)) {
    return "0s";
  }
  const end = run.status === "running" ? nowMs : Date.parse(run.updatedAt) || nowMs;
  const elapsedMs = Math.max(0, end - start);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

export function formatAgentRunTokenCount(tokens: number | undefined): string | undefined {
  if (tokens === undefined || !Number.isFinite(tokens) || tokens <= 0) {
    return undefined;
  }
  if (tokens < 1000) {
    return `${Math.round(tokens)}`;
  }
  if (tokens < 10_000) {
    return `${(tokens / 1000).toFixed(1).replace(/\.0$/u, "")}K`;
  }
  return `${Math.round(tokens / 1000)}K`;
}
