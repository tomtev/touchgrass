export type RemoteControlAction = "stop" | "kill";

export function parseRemoteControlAction(value: unknown): RemoteControlAction | null {
  if (value === "stop" || value === "kill") return value;
  return null;
}

export function mergeRemoteControlAction(
  current: RemoteControlAction | null,
  incoming: RemoteControlAction
): RemoteControlAction {
  if (incoming === "kill") return "kill";
  if (current === "kill") return "kill";
  return "stop";
}
