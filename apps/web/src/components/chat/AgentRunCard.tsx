import { memo, useEffect, useState } from "react";
import {
  formatAgentRunDuration,
  formatAgentRunTokenCount,
  type AgentRun,
  type AgentRunAgent,
  type AgentRunStatus,
} from "@t3tools/shared/agentRuns";
import { ChevronRightIcon, Layers2Icon } from "lucide-react";

import { cn } from "../../lib/utils";

function statusDotClass(status: AgentRunStatus | "pending"): string {
  switch (status) {
    case "running":
      return "bg-info animate-pulse";
    case "completed":
      return "bg-success";
    case "failed":
      return "bg-destructive";
    case "stopped":
      return "bg-warning";
    default:
      return "border border-border bg-transparent";
  }
}

function AgentStatusSquares({ agents }: { agents: ReadonlyArray<AgentRunAgent> }) {
  if (agents.length === 0) {
    return <span className={cn("size-2.5 rounded-[3px]", statusDotClass("pending"))} />;
  }
  return (
    <span className="flex items-center gap-1">
      {agents.slice(0, 6).map((agent) => (
        <span
          key={agent.id}
          title={`${agent.name} · ${agent.status}`}
          className={cn("size-2.5 rounded-[3px]", statusDotClass(agent.status))}
        />
      ))}
      {agents.length > 6 ? (
        <span className="text-[10px] text-muted-foreground">+{agents.length - 6}</span>
      ) : null}
    </span>
  );
}

function useLiveDuration(run: AgentRun): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (run.status !== "running") {
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [run.status]);
  return formatAgentRunDuration(run, now);
}

export const AgentRunCard = memo(function AgentRunCard(props: {
  run: AgentRun;
  expanded?: boolean;
  onOpen?: (runId: string) => void;
  className?: string;
}) {
  const { run, expanded = false, onOpen, className } = props;
  const duration = useLiveDuration(run);
  const tokens = formatAgentRunTokenCount(run.usageTokens);
  const kindLabel = run.taskType?.trim() || "Workflow";

  return (
    <button
      type="button"
      onClick={() => onOpen?.(run.id)}
      className={cn(
        "group/agent-run flex w-full flex-col gap-2 rounded-xl border border-border/80 bg-secondary/40 px-3 py-2.5 text-left transition-colors",
        "hover:border-border hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
        run.status === "running" && "border-info/30",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Layers2Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground/90">
          {run.title}
        </span>
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-60 transition-transform group-hover/agent-run:translate-x-0.5" />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span className="rounded-md bg-background/60 px-1.5 py-0.5 font-medium text-foreground/75">
          {kindLabel}
        </span>
        <span>
          {run.agents.length} agent{run.agents.length === 1 ? "" : "s"}
        </span>
        <span className="tabular-nums">{duration}</span>
        {tokens ? <span className="tabular-nums">{tokens} tokens</span> : null}
        <span className="ms-auto">
          <AgentStatusSquares agents={run.agents} />
        </span>
      </div>

      {expanded ? (
        <div className="mt-1 space-y-1.5 border-t border-border/60 pt-2">
          {run.summary ? (
            <p className="text-[12px] leading-5 text-muted-foreground">{run.summary}</p>
          ) : null}
          {run.agents.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border/70">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 bg-background/40 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                <span>Agent</span>
                <span>Tokens</span>
                <span>Status</span>
              </div>
              {run.agents.map((agent) => (
                <div
                  key={agent.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-t border-border/50 px-2 py-1.5 text-[11px]"
                >
                  <span className="truncate font-mono text-foreground/85">{agent.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatAgentRunTokenCount(agent.tokens) ?? "—"}
                  </span>
                  <span className="flex items-center gap-1.5 capitalize text-muted-foreground">
                    <span className={cn("size-1.5 rounded-full", statusDotClass(agent.status))} />
                    {agent.status}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </button>
  );
});

export const BackgroundTasksPanel = memo(function BackgroundTasksPanel(props: {
  runs: ReadonlyArray<AgentRun>;
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
}) {
  const { runs, selectedRunId, onSelectRun } = props;
  const selected = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;

  if (runs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Layers2Icon className="size-5 text-muted-foreground/70" />
        <p className="text-sm text-foreground/80">No background tasks</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Subagents and multi-agent workflows will show up here while they run.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-3 py-2">
        <p className="text-xs font-medium text-foreground">Background tasks</p>
        <p className="text-[11px] text-muted-foreground">
          {runs.filter((run) => run.status === "running").length} active · {runs.length} total
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-2">
          {runs.map((run) => (
            <AgentRunCard
              key={run.id}
              run={run}
              expanded={selected?.id === run.id}
              onOpen={onSelectRun}
              className={cn(selected?.id === run.id && "border-info/40 bg-info/5")}
            />
          ))}
        </div>
      </div>
    </div>
  );
});
