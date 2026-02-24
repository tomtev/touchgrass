import type { InboundMessage } from "../../channel/types";
import type { RouterContext } from "../command-router";
import { listSkills, type SkillInfo } from "../../daemon/skills";

export async function handleSkillsCommand(
  msg: InboundMessage,
  ctx: RouterContext
): Promise<void> {
  const { fmt } = ctx.channel;
  const chatId = msg.chatId;

  // Find the cwd of the active session for this chat
  const remote = ctx.sessionManager.getAttachedRemote(chatId);
  if (!remote) {
    await ctx.channel.send(chatId, `No active session. Start one with ${fmt.code("tg claude")} or ${fmt.code("tg codex")}.`);
    return;
  }

  const skills = await listSkills(remote.cwd || "");
  if (skills.length === 0) {
    await ctx.channel.send(
      chatId,
      `${fmt.escape("⛳️")} ${fmt.escape("No skills found. Add SKILL.md files to")} ${fmt.code(".agents/skills/")} ${fmt.escape("or")} ${fmt.code(".claude/skills/")}.`
    );
    return;
  }

  const lines: string[] = [
    `${fmt.escape("⛳️")} ${fmt.bold(fmt.escape(`Skills (${skills.length})`))}`,
  ];
  for (const skill of skills) {
    const scope = skill.scope === "personal" ? fmt.escape(" (personal)") : "";
    const desc = skill.description ? ` ${fmt.escape("—")} ${fmt.escape(skill.description)}` : "";
    lines.push(`${fmt.escape("•")} ${fmt.bold(fmt.escape(skill.name))}${scope}${desc}`);
  }
  await ctx.channel.send(chatId, lines.join("\n"));
}
