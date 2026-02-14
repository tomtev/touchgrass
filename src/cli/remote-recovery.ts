import type { ChannelChatId } from "../channel/types";

export type RecoveryReason = "unknown" | "unreachable";

interface DaemonRequestFn {
  (
    path: string,
    method?: "GET" | "POST",
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>>;
}

export interface RemoteRecoveryInput {
  remoteId: string;
  fullCommand: string;
  chatId: ChannelChatId;
  ownerUserId: string;
  cwd: string;
  subscribedGroups: string[];
  boundChat: ChannelChatId | null;
}

export interface RemoteRecoveryDeps {
  ensureDaemon: () => Promise<void>;
  daemonRequest: DaemonRequestFn;
  log: (text: string) => void;
  logErr: (text: string) => void;
  minIntervalMs?: number;
  now?: () => number;
}

export interface RemoteRecoveryController {
  isRecovering: () => boolean;
  recover: (reason: RecoveryReason, input: RemoteRecoveryInput) => Promise<boolean>;
}

export function createRemoteRecoveryController(
  deps: RemoteRecoveryDeps
): RemoteRecoveryController {
  const minIntervalMs = deps.minIntervalMs ?? 1500;
  const nowFn = deps.now || Date.now;
  let recovering = false;
  let lastRecoveryAttemptAt: number | null = null;
  let daemonUnavailableLogged = false;

  return {
    isRecovering: () => recovering,
    recover: async (reason: RecoveryReason, input: RemoteRecoveryInput): Promise<boolean> => {
      if (recovering) return false;
      const now = nowFn();
      if (
        reason === "unreachable" &&
        lastRecoveryAttemptAt !== null &&
        now - lastRecoveryAttemptAt < minIntervalMs
      ) {
        return false;
      }
      lastRecoveryAttemptAt = now;
      recovering = true;

      if (reason === "unknown") {
        deps.log("Lost daemon registration. Attempting re-register...");
      } else if (!daemonUnavailableLogged) {
        daemonUnavailableLogged = true;
        deps.logErr("Daemon connection lost. Attempting recovery...");
      }

      try {
        await deps.ensureDaemon();
        const regRes = await deps.daemonRequest("/remote/register", "POST", {
          command: input.fullCommand,
          chatId: input.chatId,
          ownerUserId: input.ownerUserId,
          cwd: input.cwd,
          sessionId: input.remoteId,
          subscribedGroups: input.subscribedGroups,
        });
        if (regRes.ok && input.boundChat) {
          await deps.daemonRequest("/remote/bind-chat", "POST", {
            sessionId: input.remoteId,
            chatId: input.boundChat,
            ownerUserId: input.ownerUserId,
          });
        }
        daemonUnavailableLogged = false;
        deps.log("Reconnected to daemon.");
        return true;
      } catch {
        if (reason === "unknown") {
          deps.logErr("re-registration failed; will retry.");
        }
        return false;
      } finally {
        recovering = false;
      }
    },
  };
}
