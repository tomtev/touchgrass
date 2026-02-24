import type { Formatter } from "../../channel/formatter";
import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";

function buildHelpText(fmt: Formatter): string {
  return `${fmt.bold(`${fmt.escape("⛳")} touchgrass.sh`)}

Any text you send goes to the connected session.

${fmt.bold("Commands:")}
/start_remote_control ${fmt.escape("—")} Connect a running session to this chat
/change_session ${fmt.escape("—")} Switch to a different session
/stop_remote_control ${fmt.escape("—")} Disconnect session from this chat
/session ${fmt.escape("—")} Show current session info
/files ${fmt.escape("—")} Pick repo paths for next message
/output_mode ${fmt.escape("—")} Set output style (simple/verbose)
/thinking ${fmt.escape("—")} Toggle thinking previews
/background_jobs ${fmt.escape("—")} List running background jobs
/link ${fmt.escape("—")} Add this chat as a channel
/pair ${fmt.escape("—")} Pair with a pairing code`;
}

export async function handleHelp(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  await ctx.channel.send(msg.chatId, buildHelpText(ctx.channel.fmt));
}
