export function isWhatsAppGroupJid(value: string): boolean {
  return /^[0-9-]+@g\.us$/i.test(value.trim());
}

export function isWhatsAppUserJid(value: string): boolean {
  const v = value.trim();
  return /^(\d+)(?::\d+)?@s\.whatsapp\.net$/i.test(v) || /^(\d+)@lid$/i.test(v);
}

export function jidToPhone(jid: string): string | null {
  const v = jid.trim();
  const user = v.match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/i);
  if (user) return `+${user[1]}`;
  const lid = v.match(/^(\d+)@lid$/i);
  if (lid) return `+${lid[1]}`;
  return null;
}

export function normalizeWhatsAppTarget(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.startsWith("+")) {
    const digits = v.slice(1).replace(/\D/g, "");
    return digits ? `+${digits}` : null;
  }
  if (isWhatsAppGroupJid(v)) return v;
  if (isWhatsAppUserJid(v)) return jidToPhone(v);
  return null;
}

export function toWhatsAppJid(target: string): string {
  const v = target.trim();
  if (isWhatsAppGroupJid(v)) return v;
  if (isWhatsAppUserJid(v)) return v;
  if (v.startsWith("+")) {
    const digits = v.slice(1).replace(/\D/g, "");
    if (!digits) throw new Error(`Invalid WhatsApp target: ${target}`);
    return `${digits}@s.whatsapp.net`;
  }
  throw new Error(`Invalid WhatsApp target: ${target}`);
}

export function chatIdToJid(chatId: string): string {
  if (!chatId.startsWith("whatsapp:")) {
    throw new Error(`Invalid WhatsApp chatId: ${chatId}`);
  }
  const raw = chatId.slice("whatsapp:".length);
  return toWhatsAppJid(raw);
}

export function jidToChannelChatId(remoteJid: string): string {
  if (isWhatsAppGroupJid(remoteJid)) return `whatsapp:${remoteJid}`;
  const phone = jidToPhone(remoteJid);
  if (phone) return `whatsapp:${phone}`;
  return `whatsapp:${remoteJid}`;
}

export function jidToChannelUserId(userJid: string): string | null {
  const phone = jidToPhone(userJid);
  if (phone) return `whatsapp:${phone}`;
  if (isWhatsAppUserJid(userJid)) return `whatsapp:${userJid}`;
  return null;
}
