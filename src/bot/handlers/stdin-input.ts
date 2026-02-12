import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";
import type { RemoteSession } from "../../session/manager";

// If a session has a pending poll, close it and push the text as a free-form "Other" answer
function handleTextWhilePoll(remote: RemoteSession, text: string, ctx: RouterContext): boolean {
  const activePoll = ctx.sessionManager.getActivePollForSession(remote.id);
  if (!activePoll) return false;

  // Close the active poll if the channel supports it
  if (ctx.channel.closePoll) {
    ctx.channel.closePoll(activePoll.poll.chatId, activePoll.poll.messageId).catch(() => {});
  }
  ctx.sessionManager.removePoll(activePoll.pollId);

  // Push "Other" marker then the text
  remote.inputQueue.push("\x1b[POLL_OTHER]");
  remote.inputQueue.push(text);
  ctx.sessionManager.clearPendingQuestions(remote.id);
  return true;
}

export async function handleStdinInput(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  const chatId = msg.chatId;
  const userId = msg.userId;
  const text = msg.text?.trim();
  const { fmt } = ctx.channel;
  if (!text) return;

  // Helper: when routing input from a group, subscribe the group to session output
  const maybeSubscribeGroup = (sessionId: string) => {
    if (msg.isGroup) {
      ctx.sessionManager.subscribeGroup(sessionId, chatId);
    }
  };

  // 1. Check regular attached sessions
  const session = ctx.sessionManager.getAttached(chatId);
  if (session && session.ownerUserId !== userId) {
    await ctx.channel.send(chatId, "This chat is subscribed to another user's session.");
    return;
  }
  if (session && session.ownerUserId === userId) {
    ctx.channel.setTyping(chatId, true);
    session.writeStdin(text);
    maybeSubscribeGroup(session.id);
    return;
  }

  // 2. Check attached remote sessions
  const remote = ctx.sessionManager.getAttachedRemote(chatId);
  if (remote && remote.ownerUserId !== userId) {
    await ctx.channel.send(chatId, "This chat is subscribed to another user's session.");
    return;
  }
  if (remote && remote.ownerUserId === userId) {
    if (!handleTextWhilePoll(remote, text, ctx)) {
      remote.inputQueue.push(text);
    }
    maybeSubscribeGroup(remote.id);
    return;
  }

  // 3. Single session auto-route: if exactly 1 remote, send there (DMs only)
  const remotes = ctx.sessionManager.listRemotesForUser(userId);
  if (remotes.length === 1 && !msg.isGroup) {
    if (!handleTextWhilePoll(remotes[0], text, ctx)) {
      remotes[0].inputQueue.push(text);
    }
    return;
  }

  // 4. Multiple sessions or group without connection — show session list
  if (remotes.length > 0) {
    const list = remotes.map((r) => {
      const label = r.cwd.split("/").pop() || r.id;
      return `  ${fmt.code(r.id)} ${fmt.escape("—")} ${fmt.escape(label)}`;
    }).join("\n");
    await ctx.channel.send(
      chatId,
      `${msg.isGroup ? "Use /subscribe to attach this group to a session" : "Multiple sessions active"}. Reply to a message, or prefix with session ID:\n\n${list}\n\nUse ${fmt.code(`/subscribe ${fmt.escape(remotes[0].id)}`)} to set default.`
    );
    return;
  }

  await ctx.channel.send(
    chatId,
    `No active session. Run ${fmt.code("tg claude")}, ${fmt.code("tg codex")}, or ${fmt.code("tg pi")} in your terminal.`
  );
}
