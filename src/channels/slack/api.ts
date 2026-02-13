export interface SlackAuthTest {
  user_id: string;
  user: string;
  team: string;
  team_id: string;
  bot_id?: string;
}

export interface SlackConversation {
  id: string;
  name?: string;
  is_im?: boolean;
  is_channel?: boolean;
  is_group?: boolean;
  is_mpim?: boolean;
}

interface SlackApiResponse<T> {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
  // Slack responses vary by endpoint; caller maps what it needs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
}

export class SlackApi {
  private readonly apiBase = "https://slack.com/api";

  constructor(
    private readonly botToken: string,
    private readonly appToken?: string
  ) {}

  private async callWithToken<T>(
    token: string,
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.apiBase}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(params || {}),
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") || "1");
      await Bun.sleep(Math.max(1, retryAfter) * 1000);
      return this.callWithToken(token, method, params);
    }

    const raw = await res.text();
    if (!raw) {
      throw new Error(`Slack API ${method} failed (${res.status}): empty response`);
    }

    let body: SlackApiResponse<T>;
    try {
      body = JSON.parse(raw) as SlackApiResponse<T>;
    } catch {
      throw new Error(`Slack API ${method} failed (${res.status}): ${raw}`);
    }

    if (!res.ok || !body.ok) {
      throw new Error(`Slack API ${method}: ${body.error || `HTTP ${res.status}`}`);
    }

    return body as unknown as T;
  }

  async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.callWithToken<T>(this.botToken, method, params);
  }

  async appCall<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.appToken) {
      throw new Error("Slack app token is required for Socket Mode");
    }
    return this.callWithToken<T>(this.appToken, method, params);
  }

  async authTest(): Promise<SlackAuthTest> {
    const res = await this.call<SlackApiResponse<unknown> & SlackAuthTest>("auth.test");
    return {
      user_id: res.user_id,
      user: res.user,
      team: res.team,
      team_id: res.team_id,
      bot_id: res.bot_id,
    };
  }

  async openSocketConnection(): Promise<string> {
    const res = await this.appCall<SlackApiResponse<unknown> & { url?: string }>("apps.connections.open");
    if (!res.url) {
      throw new Error("Slack API apps.connections.open returned no URL");
    }
    return res.url;
  }

  async openDm(userId: string): Promise<string> {
    const res = await this.call<SlackApiResponse<unknown> & { channel?: { id?: string } }>(
      "conversations.open",
      { users: userId }
    );
    const channelId = res.channel?.id;
    if (!channelId) throw new Error("Slack API conversations.open returned no channel id");
    return channelId;
  }

  async sendMessage(
    channel: string,
    text: string,
    threadTs?: string
  ): Promise<{ channel: string; ts: string }> {
    const res = await this.call<SlackApiResponse<unknown> & { channel?: string; ts?: string }>(
      "chat.postMessage",
      {
        channel,
        text,
        mrkdwn: true,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      }
    );
    if (!res.channel || !res.ts) {
      throw new Error("Slack API chat.postMessage returned no channel/ts");
    }
    return { channel: res.channel, ts: res.ts };
  }

  async updateMessage(
    channel: string,
    ts: string,
    text: string
  ): Promise<void> {
    await this.call("chat.update", {
      channel,
      ts,
      text,
      mrkdwn: true,
    });
  }

  async getConversationInfo(channel: string): Promise<SlackConversation> {
    const res = await this.call<SlackApiResponse<unknown> & { channel?: SlackConversation }>(
      "conversations.info",
      { channel }
    );
    if (!res.channel?.id) {
      throw new Error("Slack API conversations.info returned no channel");
    }
    return res.channel;
  }

  async getUserInfo(userId: string): Promise<{ id: string; name?: string; real_name?: string }> {
    const res = await this.call<SlackApiResponse<unknown> & { user?: { id?: string; name?: string; real_name?: string } }>(
      "users.info",
      { user: userId }
    );
    if (!res.user?.id) {
      throw new Error("Slack API users.info returned no user");
    }
    return {
      id: res.user.id,
      name: res.user.name,
      real_name: res.user.real_name,
    };
  }

  async sendFile(
    channel: string,
    filePath: string,
    caption?: string,
    threadTs?: string
  ): Promise<void> {
    const file = Bun.file(filePath);
    const form = new FormData();
    form.append("channels", channel);
    form.append("file", file, filePath.split("/").pop() || "file");
    if (caption) form.append("initial_comment", caption);
    if (threadTs) form.append("thread_ts", threadTs);

    const url = `${this.apiBase}/files.upload`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.botToken}`,
      },
      body: form,
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") || "1");
      await Bun.sleep(Math.max(1, retryAfter) * 1000);
      return this.sendFile(channel, filePath, caption, threadTs);
    }

    const raw = await res.text();
    if (!raw) {
      throw new Error(`Slack API files.upload failed (${res.status}): empty response`);
    }

    let body: SlackApiResponse<unknown>;
    try {
      body = JSON.parse(raw) as SlackApiResponse<unknown>;
    } catch {
      throw new Error(`Slack API files.upload failed (${res.status}): ${raw}`);
    }

    if (!res.ok || !body.ok) {
      throw new Error(`Slack API files.upload: ${body.error || `HTTP ${res.status}`}`);
    }
  }

  async downloadPrivateFile(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.botToken}`,
      },
    });
    if (!res.ok) {
      throw new Error(`Slack file download failed (${res.status})`);
    }
    return await res.arrayBuffer();
  }
}

