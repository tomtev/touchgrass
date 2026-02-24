interface RateEntry {
  attempts: number;
  windowStart: number;
}

const limits: Map<string, RateEntry> = new Map();

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60 * 1000; // 1 minute

export function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = limits.get(userId);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    limits.set(userId, { attempts: 1, windowStart: now });
    return true;
  }

  if (entry.attempts >= MAX_ATTEMPTS) {
    return false;
  }

  entry.attempts++;
  return true;
}

export function resetRateLimit(userId: string): void {
  limits.delete(userId);
}
