export interface ParsedChannelAddress {
  type: string;
  channelName?: string;
  idPart?: string;
  threadPart?: string;
  scoped: boolean;
}

const NUMERIC_SEGMENT_RE = /^-?\d+$/;

function isNumericSegment(value: string | undefined): boolean {
  return !!value && NUMERIC_SEGMENT_RE.test(value);
}

export function parseChannelAddress(value: string): ParsedChannelAddress {
  const parts = value.split(":");
  const type = parts[0] || "";
  if (!type) return { type: "", scoped: false };

  const second = parts[1];
  if (parts.length >= 3 && second && !isNumericSegment(second)) {
    return {
      type,
      channelName: second,
      idPart: parts[2],
      threadPart: parts[3],
      scoped: true,
    };
  }

  return {
    type,
    idPart: second,
    threadPart: parts[2],
    scoped: false,
  };
}

export function getChannelType(value: string): string {
  return parseChannelAddress(value).type;
}

export function getChannelName(value: string): string | undefined {
  return parseChannelAddress(value).channelName;
}

export function getRootChatIdNumber(chatId: string): number | null {
  const parsed = parseChannelAddress(chatId);
  if (!parsed.idPart || !isNumericSegment(parsed.idPart)) return null;
  const id = Number(parsed.idPart);
  return Number.isFinite(id) ? id : null;
}

export function isTopicChatId(chatId: string): boolean {
  const parsed = parseChannelAddress(chatId);
  return !!parsed.threadPart;
}

export function getParentChannelChatId(chatId: string): string {
  const parsed = parseChannelAddress(chatId);
  if (!parsed.type || !parsed.idPart) return chatId;
  if (parsed.scoped && parsed.channelName) {
    return `${parsed.type}:${parsed.channelName}:${parsed.idPart}`;
  }
  return `${parsed.type}:${parsed.idPart}`;
}

