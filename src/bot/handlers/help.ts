import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";

const HELP_TEXT = `<b>TouchGrass</b> — touchgrass.sh

<b>Sessions:</b>
Any text you send goes to the connected session.
Reply to a message to send to that specific session.

<b>Commands:</b>
/sessions — List active sessions
/connect &lt;id&gt; — Connect to a session
/disconnect — Disconnect from current session
/send &lt;id&gt; &lt;text&gt; — Send to a specific session
/help — Show this help
/pair &lt;code&gt; — Pair with a pairing code

Run <code>tg pair</code> on the server to generate a code.`;

export async function handleHelp(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  await ctx.channel.send(msg.chatId, HELP_TEXT);
}
