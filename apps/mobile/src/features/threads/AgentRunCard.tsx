import { Pressable, View } from "react-native";
import {
  formatAgentRunDuration,
  formatAgentRunTokenCount,
  type AgentRun,
  type AgentRunAgent,
  type AgentRunStatus,
} from "@t3tools/shared/agentRuns";
import { useEffect, useState } from "react";

import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";

function statusClass(status: AgentRunStatus | "pending"): string {
  switch (status) {
    case "running":
      return "bg-sky-500";
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-rose-500";
    case "stopped":
      return "bg-amber-500";
    default:
      return "border border-border bg-transparent";
  }
}

function AgentSquares({ agents }: { agents: ReadonlyArray<AgentRunAgent> }) {
  if (agents.length === 0) {
    return <View className={cn("h-2.5 w-2.5 rounded-[3px]", statusClass("pending"))} />;
  }
  return (
    <View className="flex-row items-center gap-1">
      {agents.slice(0, 6).map((agent) => (
        <View
          key={agent.id}
          className={cn("h-2.5 w-2.5 rounded-[3px]", statusClass(agent.status))}
        />
      ))}
    </View>
  );
}

function useLiveDuration(run: AgentRun): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (run.status !== "running") {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [run.status]);
  return formatAgentRunDuration(run, now);
}

export function MobileAgentRunCard(props: {
  readonly run: AgentRun;
  readonly expanded?: boolean;
  readonly onPress?: (runId: string) => void;
}) {
  const duration = useLiveDuration(props.run);
  const tokens = formatAgentRunTokenCount(props.run.usageTokens);
  const kindLabel = props.run.taskType?.trim() || "Workflow";

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => props.onPress?.(props.run.id)}
      className={cn(
        "rounded-xl border border-border/80 bg-secondary/50 px-3 py-2.5",
        props.run.status === "running" && "border-sky-500/40",
      )}
    >
      <View className="mb-1.5 flex-row items-center gap-2">
        <Text className="min-w-0 flex-1 font-mono text-xs text-foreground" numberOfLines={1}>
          {props.run.title}
        </Text>
        <Text className="text-2xs text-foreground-muted">›</Text>
      </View>
      <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
        <Text className="rounded-md bg-background/70 px-1.5 py-0.5 font-t3-medium text-2xs text-foreground">
          {kindLabel}
        </Text>
        <Text className="text-2xs text-foreground-muted">
          {props.run.agents.length} agent{props.run.agents.length === 1 ? "" : "s"}
        </Text>
        <Text className="text-2xs tabular-nums text-foreground-muted">{duration}</Text>
        {tokens ? (
          <Text className="text-2xs tabular-nums text-foreground-muted">{tokens} tokens</Text>
        ) : null}
        <View className="ml-auto">
          <AgentSquares agents={props.run.agents} />
        </View>
      </View>

      {props.expanded ? (
        <View className="mt-2 gap-1.5 border-t border-border/60 pt-2">
          {props.run.summary ? (
            <Text className="text-xs leading-5 text-foreground-muted">{props.run.summary}</Text>
          ) : null}
          {props.run.agents.map((agent) => (
            <View key={agent.id} className="flex-row items-center gap-2">
              <View className={cn("h-1.5 w-1.5 rounded-full", statusClass(agent.status))} />
              <Text className="min-w-0 flex-1 font-mono text-2xs text-foreground" numberOfLines={1}>
                {agent.name}
              </Text>
              <Text className="text-2xs capitalize text-foreground-muted">{agent.status}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}
