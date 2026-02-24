import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";
import { getChatOutputMode, setChatOutputMode, type OutputMode } from "../../config/schema";
import { saveConfig } from "../../config/store";

const OUTPUT_MODE_CHOICES: Array<{ mode: OutputMode; label: string }> = [
  { mode: "compact", label: "Simple (default)" },
  { mode: "verbose", label: "Verbose" },
];

const VALID_MODES = new Set<OutputMode>(OUTPUT_MODE_CHOICES.map((choice) => choice.mode));

function usageText(): string {
  return "Usage: /output_mode simple|verbose";
}

function normalizeOutputModeArg(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "simple") return "compact";
  return normalized;
}

function formatOutputModeLabel(mode: OutputMode): string {
  if (mode === "compact") return "simple";
  return mode;
}

export async function handleOutputModeCommand(
  msg: InboundMessage,
  modeArg: string | undefined,
  ctx: RouterContext
): Promise<void> {
  const { fmt } = ctx.channel;
  const normalized = modeArg ? normalizeOutputModeArg(modeArg) : undefined;
  const current = getChatOutputMode(ctx.config, msg.chatId);
  const currentLabel = formatOutputModeLabel(current);

  if (!normalized) {
    if (ctx.channel.sendPoll) {
      const sent = await ctx.channel.sendPoll(
        msg.chatId,
        `Output mode (current: ${currentLabel})`,
        OUTPUT_MODE_CHOICES.map((choice) => choice.label),
        false
      );
      ctx.sessionManager.registerOutputModePicker({
        pollId: sent.pollId,
        messageId: sent.messageId,
        chatId: msg.chatId,
        ownerUserId: msg.userId,
        options: OUTPUT_MODE_CHOICES.map((choice) => choice.mode),
      });
      return;
    }
    await ctx.channel.send(
      msg.chatId,
      `${fmt.escape("⛳️")} Output mode for this chat is ${fmt.code(fmt.escape(currentLabel))}.\n${fmt.escape("simple = cleaner bridge output, verbose = include tool call/result logs.")}\n${fmt.escape(usageText())}`
    );
    return;
  }

  if (!VALID_MODES.has(normalized as OutputMode)) {
    await ctx.channel.send(msg.chatId, `${fmt.escape(usageText())}\n${fmt.escape("Current mode:")} ${fmt.code(fmt.escape(currentLabel))}`);
    return;
  }

  const nextMode = normalized as OutputMode;
  const changed = setChatOutputMode(ctx.config, msg.chatId, nextMode);
  if (changed) {
    await saveConfig(ctx.config);
  }

  await ctx.channel.send(
    msg.chatId,
    `${fmt.escape("⛳️")} Output mode is now ${fmt.code(fmt.escape(formatOutputModeLabel(nextMode)))} for this chat.`
  );
}
