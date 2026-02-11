import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";

const HELP_TEXT = `⛳ <b>touchgrass.sh</b>

<b>Sessions:</b>
Any text you send goes to the bound session.

<b>Commands:</b>
/sessions — List active sessions
/bind &lt;id&gt; — Bind this chat to a session
/unbind — Unbind from current session
/link — Register this group with the bot
/help — Show this help
/pair &lt;code&gt; — Pair with a pairing code

Run <code>tg pair</code> on the server to generate a code.`;

export async function handleHelp(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  await ctx.channel.send(msg.chatId, HELP_TEXT);
}
