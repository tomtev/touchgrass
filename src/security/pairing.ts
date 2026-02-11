import { randomBytes, createHash } from "crypto";

interface PendingCode {
  hash: string;
  expiresAt: number;
}

const pendingCodes: Map<string, PendingCode> = new Map();

export function generatePairingCode(): string {
  const code = randomBytes(16).toString("hex");
  const hash = hashCode(code);
  pendingCodes.set(hash, {
    hash,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });
  return code;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function validatePairingCode(code: string): boolean {
  const hash = hashCode(code.trim());
  const entry = pendingCodes.get(hash);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    pendingCodes.delete(hash);
    return false;
  }
  // Single-use: delete after validation
  pendingCodes.delete(hash);
  return true;
}

// Clean up expired codes periodically
export function cleanExpiredCodes(): void {
  const now = Date.now();
  for (const [hash, entry] of pendingCodes) {
    if (now > entry.expiresAt) {
      pendingCodes.delete(hash);
    }
  }
}

// Get active code count (for doctor/status)
export function getPendingCodeCount(): number {
  cleanExpiredCodes();
  return pendingCodes.size;
}
