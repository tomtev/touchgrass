import { describe, expect, it } from "bun:test";
import {
  chatIdToJid,
  isWhatsAppGroupJid,
  jidToChannelChatId,
  jidToChannelUserId,
  normalizeWhatsAppTarget,
  toWhatsAppJid,
} from "../channels/whatsapp/normalize";

describe("whatsapp normalize", () => {
  it("normalizes user targets", () => {
    expect(normalizeWhatsAppTarget("+1 (555) 123-9999")).toBe("+15551239999");
    expect(normalizeWhatsAppTarget("15551239999@s.whatsapp.net")).toBe("+15551239999");
    expect(normalizeWhatsAppTarget("15551239999:3@s.whatsapp.net")).toBe("+15551239999");
    expect(normalizeWhatsAppTarget("120363401234567890@g.us")).toBe("120363401234567890@g.us");
    expect(normalizeWhatsAppTarget("wat")).toBeNull();
  });

  it("converts chat ids to jids", () => {
    expect(chatIdToJid("whatsapp:+15551239999")).toBe("15551239999@s.whatsapp.net");
    expect(chatIdToJid("whatsapp:120363401234567890@g.us")).toBe("120363401234567890@g.us");
  });

  it("maps jids to channel ids", () => {
    expect(jidToChannelChatId("15551239999@s.whatsapp.net")).toBe("whatsapp:+15551239999");
    expect(jidToChannelChatId("120363401234567890@g.us")).toBe("whatsapp:120363401234567890@g.us");
    expect(jidToChannelUserId("15551239999:7@s.whatsapp.net")).toBe("whatsapp:+15551239999");
  });

  it("validates group jids and user jids", () => {
    expect(isWhatsAppGroupJid("120363401234567890@g.us")).toBe(true);
    expect(isWhatsAppGroupJid("15551239999@s.whatsapp.net")).toBe(false);
    expect(toWhatsAppJid("+15551239999")).toBe("15551239999@s.whatsapp.net");
  });
});
