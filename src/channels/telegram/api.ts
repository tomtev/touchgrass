export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  reply_to_message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface ApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
  parameters?: { retry_after?: number };
}

export class TelegramApi {
  private baseUrl: string;

  constructor(private token: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: params ? JSON.stringify(params) : undefined,
    });

    if (res.status === 429) {
      const body = (await res.json()) as ApiResponse<T>;
      const retryAfter = body.parameters?.retry_after ?? 5;
      await Bun.sleep(retryAfter * 1000);
      return this.call(method, params);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telegram API ${method} failed (${res.status}): ${body}`);
    }

    const body = (await res.json()) as ApiResponse<T>;
    if (!body.ok) {
      throw new Error(`Telegram API ${method}: ${body.description}`);
    }
    return body.result;
  }

  async getMe(): Promise<TelegramUser> {
    return this.call<TelegramUser>("getMe");
  }

  async getUpdates(offset?: number, timeout = 30): Promise<TelegramUpdate[]> {
    return this.call<TelegramUpdate[]>("getUpdates", {
      offset,
      timeout,
      allowed_updates: ["message"],
    });
  }

  async sendMessage(
    chatId: number,
    text: string,
    parseMode: "HTML" | "MarkdownV2" | "" = "HTML"
  ): Promise<TelegramMessage> {
    return this.call<TelegramMessage>("sendMessage", {
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });
  }

  async setMyCommands(
    commands: Array<{ command: string; description: string }>
  ): Promise<true> {
    return this.call<true>("setMyCommands", { commands });
  }

  async getFile(fileId: string): Promise<TelegramFile> {
    return this.call<TelegramFile>("getFile", { file_id: fileId });
  }

  getFileUrl(filePath: string): string {
    return `https://api.telegram.org/file/bot${this.token}/${filePath}`;
  }

  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    parseMode: "HTML" | "MarkdownV2" | "" = "HTML"
  ): Promise<TelegramMessage | true> {
    return this.call<TelegramMessage | true>("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });
  }
}
