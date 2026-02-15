import type { Formatter } from "../../channel/formatter";
import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";

function buildHelpText(fmt: Formatter): string {
  return `${fmt.bold(`${fmt.escape("⛳")} touchgrass.sh`)}

${fmt.bold("Sessions:")}
Any text you send goes to the connected session.

${fmt.bold("Commands:")}
/files ${fmt.escape("or")} ${fmt.code("tg files [query]")} ${fmt.escape("—")} Pick one or more repo paths (files/folders) for next message
${fmt.code("@?query")} ${fmt.escape("—")} Shorthand for file picker (same as /files query)
${fmt.code("@?query - prompt")} ${fmt.escape("—")} Resolve top path and send as @path - prompt
/resume ${fmt.escape("or")} ${fmt.code("tg resume")} ${fmt.escape("—")} Pick a previous session and restart this tool on it
/background-jobs ${fmt.escape("or")} ${fmt.code("tg background-jobs")} ${fmt.escape("—")} Show currently running background jobs
/link ${fmt.escape("or")} ${fmt.code("tg link")} ${fmt.escape("—")} Add this chat as a channel
/unlink ${fmt.escape("or")} ${fmt.code("tg unlink")} ${fmt.escape("—")} Remove this chat as a channel
/help ${fmt.escape("or")} ${fmt.code("tg help")} ${fmt.escape("—")} Show this help
/pair ${fmt.escape("<code> or")} ${fmt.code("tg pair <code>")} ${fmt.escape("—")} Pair with a pairing code
/sessions ${fmt.escape("or")} ${fmt.code("tg sessions")} ${fmt.escape("—")} List active sessions

Run ${fmt.code(`tg pair`)} on the server to generate a code.`;
}

export async function handleHelp(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  await ctx.channel.send(msg.chatId, buildHelpText(ctx.channel.fmt));
}
