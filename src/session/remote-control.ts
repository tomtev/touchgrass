export interface RemoteResumeControlAction {
  type: "resume";
  sessionRef: string;
}

export interface RemoteStartControlAction {
  type: "start";
  tool?: "claude" | "codex" | "pi" | "kimi";
  args?: string[];
}

export type RemoteControlAction = "stop" | "kill" | RemoteResumeControlAction | RemoteStartControlAction;

function isResumeControlAction(value: unknown): value is RemoteResumeControlAction {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return raw.type === "resume" && typeof raw.sessionRef === "string" && raw.sessionRef.length > 0;
}

function isStartControlAction(value: unknown): value is RemoteStartControlAction {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  if (raw.type !== "start") return false;
  if (
    raw.tool !== undefined &&
    raw.tool !== "claude" &&
    raw.tool !== "codex" &&
    raw.tool !== "pi" &&
    raw.tool !== "kimi"
  ) {
    return false;
  }
  if (raw.args !== undefined) {
    if (!Array.isArray(raw.args)) return false;
    if (raw.args.some((value) => typeof value !== "string")) return false;
  }
  return true;
}

export function parseRemoteControlAction(value: unknown): RemoteControlAction | null {
  if (value === "stop" || value === "kill") return value;
  if (isResumeControlAction(value)) return { type: "resume", sessionRef: value.sessionRef };
  if (isStartControlAction(value)) {
    return {
      type: "start",
      ...(value.tool ? { tool: value.tool } : {}),
      ...(value.args ? { args: value.args } : {}),
    };
  }
  return null;
}

export function mergeRemoteControlAction(
  current: RemoteControlAction | null,
  incoming: RemoteControlAction
): RemoteControlAction {
  if (incoming === "kill") return "kill";
  if (current === "kill") return "kill";
  if (incoming !== "stop") return incoming;
  if (current && current !== "stop") return current;
  return "stop";
}
