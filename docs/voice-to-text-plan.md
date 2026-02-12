# Voice-to-Text Plan

## Goal

Let users send voice messages in Telegram and have them transcribed to text before being routed to CLI sessions. The voice message becomes indistinguishable from typed text once transcribed.

## Current State

- `TelegramChannel` already handles photo/document downloads via `getFile()` + fetch + disk save
- `InboundMessage` has a `text` field (required, string) and optional `fileUrls`
- Voice messages (`message.voice`) are **not handled** — they are silently ignored
- Telegram voice messages arrive as OGG Opus (`.oga`), typically <1 MB for several minutes of audio

## Transcription Provider Comparison

| Provider | Cost/min | OGG Opus native? | Latency | Languages | Offline? |
|---|---|---|---|---|---|
| **Groq Whisper** | ~$0.002 | Yes | <1s (164x real-time) | 99 | No |
| **OpenAI Whisper** | $0.006 | Yes (`.ogg`) | 1-3s | 99 | No |
| **OpenAI gpt-4o-mini-transcribe** | $0.003 | Yes | 1-3s | 99 | No |
| **Deepgram Nova-3** | $0.004 | Yes | <300ms | 30+ | No |
| **Google Cloud STT** | $0.016-$0.036 | Yes (`OGG_OPUS`) | 2-5s | 125+ | No |
| **whisper.cpp (local)** | Free | No (needs WAV via ffmpeg) | 2-10s | 99 | Yes |

### Recommendation: Groq Whisper (default), with provider abstraction

- Cheapest cloud option ($0.002/min)
- Fastest (164x real-time — a 60s voice note transcribes in <1s)
- OGG Opus accepted natively — no ffmpeg dependency
- OpenAI-compatible REST API — easy to swap for OpenAI if user prefers
- 99 languages with auto-detection

A `TranscriptionProvider` interface keeps the door open for other backends (OpenAI, local Whisper, etc.) without overengineering now.

## Architecture

```
Voice message arrives in TelegramChannel.startReceiving()
    |
    v
Detect msg.voice (or msg.video_note)
    |
    v
Download .oga via getFile() + fetch (existing pattern)
    |
    v
Send to transcription provider (Groq API)
    |
    v
Inject transcribed text as InboundMessage.text
    |
    v
Route through command-router as normal typed text
```

Voice messages are **transparent** to everything above `TelegramChannel` — the channel layer handles transcription and passes plain text to the router. No changes needed in `command-router.ts`, `stdin-input.ts`, or `SessionManager`.

## Implementation Plan

### 1. Add `voice` field to `TelegramMessage` type

**File:** `src/channels/telegram/api.ts`

Add to the `TelegramMessage` interface:
```typescript
voice?: {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
};
video_note?: {
  file_id: string;
  file_unique_id: string;
  length: number;
  duration: number;
  file_size?: number;
};
```

### 2. Create transcription module

**File:** `src/channels/telegram/transcribe.ts`

```typescript
interface TranscriptionProvider {
  transcribe(audioPath: string): Promise<string>;
}
```

Implement `GroqWhisperProvider`:
- `POST https://api.groq.com/openai/v1/audio/transcriptions`
- Multipart form: `file` (the .oga), `model` ("whisper-large-v3-turbo"), `response_format` ("text")
- Auth: `Authorization: Bearer <GROQ_API_KEY>`
- Returns plain text transcription

The provider reads the API key from config (see step 4).

### 3. Handle voice messages in `TelegramChannel`

**File:** `src/channels/telegram/channel.ts`

In the `startReceiving()` message processing loop, add voice handling alongside existing photo/document handling:

```
if (msg.voice || msg.video_note) {
  1. Extract file_id from msg.voice or msg.video_note
  2. Download via getFile() + fetch (same as photos)
  3. Call transcriptionProvider.transcribe(localPath)
  4. Set text = transcribed result
  5. Optionally prefix with "[voice] " or similar indicator
  6. Clean up downloaded audio file after transcription
  7. If transcription fails, send error reply to user and skip message
}
```

For `video_note` (round video messages), only the audio track matters — Groq/OpenAI handles this fine since the file contains an audio stream.

### 4. Config changes

**File:** `src/config/schema.ts`

Add transcription settings to channel config or global settings:

```typescript
// In TgSettings or ChannelConfig
transcription?: {
  provider: "groq" | "openai";  // default: "groq"
  apiKey: string;                // provider API key
  model?: string;                // default: "whisper-large-v3-turbo"
  language?: string;             // optional: force language (auto-detect by default)
};
```

### 5. CLI config support

**File:** `src/cli/config.ts`

Add `tg config transcription` subcommand or extend `tg init` to optionally set up voice transcription (API key prompt).

### 6. User feedback

When a voice message is received and transcribed:
- Send a brief reply: `"Transcribed: <first 100 chars>..."` so the user knows what was understood
- Then route the full text to the session as normal
- If transcription fails (bad API key, service down), reply with an error and don't route garbage

## File Changes Summary

| File | Change |
|------|--------|
| `src/channels/telegram/api.ts` | Add `voice`, `video_note` to `TelegramMessage` |
| `src/channels/telegram/transcribe.ts` | **New** — `TranscriptionProvider` interface + `GroqWhisperProvider` |
| `src/channels/telegram/channel.ts` | Download voice files + call transcriber in `startReceiving()` |
| `src/config/schema.ts` | Add `transcription` settings |
| `src/config/store.ts` | Handle missing transcription config gracefully |
| `src/cli/config.ts` or `src/cli/init.ts` | API key setup flow |

## Open Questions

1. **Prefix transcribed text?** Should we add `[voice]` prefix so the CLI user/agent knows input came from voice? Could be a setting.
2. **Video notes?** Should we transcribe round video messages too, or only voice notes? (Recommending yes — same flow, audio extraction is automatic.)
3. **Max duration?** Groq accepts up to 25 MB files. A 10-minute voice note is ~2 MB. Probably no limit needed, but could cap at e.g. 5 minutes to avoid surprise costs.
4. **Fallback?** If no transcription API key is configured and a voice message arrives, should we reply "Voice messages not configured — set up with `tg config transcription`" or silently ignore?

## Cost Estimate

At Groq's $0.002/min:
- 100 voice messages/day averaging 30 seconds each = 50 minutes = **$0.10/day**
- Even heavy use is under $5/month
- OpenAI would be ~3x more ($0.30/day) for the same usage

## Future Extensions

- **OpenAI provider** — swap base URL from Groq to OpenAI (same API shape)
- **Local Whisper** — `whisper.cpp` via `Bun.spawn()`, requires ffmpeg for OGG→WAV conversion
- **Voice replies** — text-to-speech for agent responses (separate feature, much more complex)
- **Streaming transcription** — for very long voice messages, start routing partial text before full transcription completes (probably unnecessary given Groq's speed)
