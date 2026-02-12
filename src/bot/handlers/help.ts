import type { Formatter } from "../../channel/formatter";
import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";

function buildHelpText(fmt: Formatter): string {
  return `${fmt.bold(`${fmt.escape("⛳")} touchgrass.sh`)}

${fmt.bold("Sessions:")}
Any text you send goes to the subscribed session.

${fmt.bold("Commands:")}
/sessions ${fmt.escape("—")} List active sessions
/subscribe ${fmt.escape("<id> —")} Subscribe this chat to a session
/unsubscribe ${fmt.escape("—")} Unsubscribe from current session
/link ${fmt.escape("—")} Register this group with the bot
/help ${fmt.escape("—")} Show this help
/pair ${fmt.escape("<code> —")} Pair with a pairing code

Run ${fmt.code(`tg pair`)} on the server to generate a code.`;
}

export async function handleHelp(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  await ctx.channel.send(msg.chatId, buildHelpText(ctx.channel.fmt));
}
