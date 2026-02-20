export interface RemoteResumeControlAction {
  type: "resume";
  sessionRef: string;
}

export type RemoteControlAction = "stop" | "kill" | RemoteResumeControlAction;

const UNSAFE_SESSION_REF = /[;&|`$(){}!#<>\\'"]/;

function isResumeControlAction(value: unknown): value is RemoteResumeControlAction {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return raw.type === "resume" && typeof raw.sessionRef === "string" && raw.sessionRef.length > 0 && !UNSAFE_SESSION_REF.test(raw.sessionRef);
}

export function parseRemoteControlAction(value: unknown): RemoteControlAction | null {
  if (value === "stop" || value === "kill") return value;
  if (isResumeControlAction(value)) return { type: "resume", sessionRef: value.sessionRef };
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
