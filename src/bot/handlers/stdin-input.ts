import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";

export async function handleStdinInput(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  const chatId = msg.chatId;
  const text = msg.text?.trim();
  if (!text) return;

  // Helper: when routing input from a group, subscribe the group to session output
  const maybeSubscribeGroup = (sessionId: string) => {
    if (msg.isGroup) {
      ctx.sessionManager.subscribeGroup(sessionId, chatId);
    }
  };

  // 1. Reply-to routing: if replying to a bot message, find which session sent it
  if (msg.replyToRef) {
    let sessionId = ctx.sessionManager.getSessionByMessage(msg.replyToRef);
    if (sessionId) {
      const remote = ctx.sessionManager.getRemote(sessionId);
      if (remote) {
        remote.inputQueue.push(text);
        maybeSubscribeGroup(sessionId);
        return;
      }
      const session = ctx.sessionManager.get(sessionId);
      if (session && session.state === "running") {
        session.writeStdin(text);
        maybeSubscribeGroup(sessionId);
        return;
      }
    }
  }

  // 2. Session prefix: "r-abc123 some text"
  const prefixMatch = text.match(/^(r-[a-f0-9]+)\s+(.+)$/s);
  if (prefixMatch) {
    const [, sessionId, input] = prefixMatch;
    const remote = ctx.sessionManager.getRemote(sessionId);
    if (remote) {
      remote.inputQueue.push(input);
      maybeSubscribeGroup(sessionId);
      return;
    }
  }

  // 3. Check regular attached sessions
  const session = ctx.sessionManager.getAttached(chatId);
  if (session) {
    session.writeStdin(text);
    maybeSubscribeGroup(session.id);
    return;
  }

  // 4. Check attached remote sessions
  const remote = ctx.sessionManager.getAttachedRemote(chatId);
  if (remote) {
    remote.inputQueue.push(text);
    maybeSubscribeGroup(remote.id);
    return;
  }

  // 5. Single session auto-route: if exactly 1 remote, send there (DMs only)
  const remotes = ctx.sessionManager.listRemotes();
  if (remotes.length === 1 && !msg.isGroup) {
    remotes[0].inputQueue.push(text);
    return;
  }

  // 6. Multiple sessions or group without connection — show session list
  if (remotes.length > 0) {
    const list = remotes.map((r) => {
      const label = r.name || r.cwd.split("/").pop() || r.id;
      return `  <code>${r.id}</code> — ${label}`;
    }).join("\n");
    await ctx.channel.send(
      chatId,
      `${msg.isGroup ? "Use /connect to attach this group to a session" : "Multiple sessions active"}. Reply to a message, or prefix with session ID:\n\n${list}\n\nUse <code>/connect ${remotes[0].id}</code> to set default.`
    );
    return;
  }

  await ctx.channel.send(
    chatId,
    "No active session. Run <code>tg claude</code>, <code>tg codex</code>, or <code>tg pi</code> in your terminal."
  );
}
