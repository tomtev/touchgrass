import { randomBytes } from "crypto";
import type { ChannelChatId, ChannelUserId } from "../channel/types";
import type { SessionState, SessionEvents } from "./types";
import { OutputBuffer } from "./output-buffer";
import { logger } from "../daemon/logger";

export class Session {
  readonly id: string;
  readonly command: string;
  readonly createdAt: string;
  readonly ownerChatId: ChannelChatId;
  readonly ownerUserId: ChannelUserId;
  state: SessionState = "running";
  exitCode: number | null = null;

  private proc: ReturnType<typeof Bun.spawn>;
  private outputBuffer: OutputBuffer;
  private decoder = new TextDecoder();

  constructor(
    command: string,
    args: string[],
    ownerChatId: ChannelChatId,
    ownerUserId: ChannelUserId,
    events: SessionEvents,
    settings: { minMs: number; maxMs: number; maxChars: number }
  ) {
    this.id = randomBytes(3).toString("hex");
    this.command = [command, ...args].join(" ");
    this.createdAt = new Date().toISOString();
    this.ownerChatId = ownerChatId;
    this.ownerUserId = ownerUserId;

    this.outputBuffer = new OutputBuffer(
      (data) => events.onOutput(this.id, data),
      settings.minMs,
      settings.maxMs,
      settings.maxChars
    );

    // Spawn directly without shell interpolation to avoid command injection.
    this.proc = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLUMNS: "120",
        LINES: "40",
      },
    });

    // Read stdout
    if (this.proc.stdout && typeof this.proc.stdout !== "number") {
      this.readStream(this.proc.stdout as ReadableStream<Uint8Array>);
    }
    // Read stderr
    if (this.proc.stderr && typeof this.proc.stderr !== "number") {
      this.readStream(this.proc.stderr as ReadableStream<Uint8Array>);
    }

    // Monitor exit
    this.proc.exited.then((code) => {
      this.outputBuffer.flush();
      this.state = "exited";
      this.exitCode = code;
      events.onExit(this.id, code);
      logger.info("Session exited", { id: this.id, tool: command, exitCode: code });
    });

    logger.info("Session created", { id: this.id, tool: command, ownerChatId, ownerUserId });
  }

  private async readStream(
    stream: ReadableStream<Uint8Array>
  ): Promise<void> {
    if (!stream) return;
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = this.decoder.decode(value, { stream: true });
        this.outputBuffer.push(text);
      }
    } catch {
      // Stream closed
    }
  }

  writeStdin(data: string): void {
    if (this.state !== "running" || !this.proc.stdin) return;
    const sink = this.proc.stdin as import("bun").FileSink;
    sink.write(new TextEncoder().encode(data + "\n"));
    sink.flush();
  }

  sendSignal(signal: number): void {
    this.proc.kill(signal);
  }

  stop(): void {
    this.sendSignal(15); // SIGTERM
  }

  kill(): void {
    this.sendSignal(9); // SIGKILL
  }

  destroy(): void {
    this.outputBuffer.destroy();
    if (this.state === "running") {
      this.kill();
    }
  }
}
