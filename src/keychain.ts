import { execSync } from "node:child_process";

const SERVICE = "nyanclaw";

/**
 * Check if we're on macOS (only platform with `security` CLI).
 */
function isMacOS(): boolean {
  return process.platform === "darwin";
}

/**
 * Retrieve an API key from the macOS Keychain.
 *
 * Uses `security find-generic-password` which reads from the user's login
 * keychain. The key is stored and retrieved securely — at rest it's encrypted
 * by the Keychain (hardware-backed on Apple Silicon).
 *
 * Returns `null` if the entry doesn't exist or on non-macOS platforms.
 */
export function getKeychainKey(account: string): string | null {
  if (!isMacOS()) return null;

  try {
    const output = execSync(
      `security find-generic-password -s '${SERVICE}' -a '${account}' -w 2>/dev/null`,
      { encoding: "utf-8", timeout: 3000 },
    );
    return output.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Remove an API key from the macOS Keychain.
 *
 * Silently succeeds if the entry doesn't exist.
 * On non-macOS platforms this is a no-op.
 */
export function deleteKeychainKey(account: string): void {
  if (!isMacOS()) return;
  try {
    execSync(
      `security delete-generic-password -s '${SERVICE}' -a '${account}' 2>/dev/null`,
      { timeout: 3000 },
    );
  } catch {}
}

/**
 * Store an API key in the macOS Keychain.
 *
 * Creates a generic password item with the specified account name.
 * The key is encrypted by the Keychain subsystem.
 *
 * On non-macOS platforms this is a no-op.
 */
export function setKeychainKey(account: string, key: string): void {
  if (!isMacOS()) return;

  // Remove existing entry first to avoid duplication
  try {
    execSync(
      `security delete-generic-password -s '${SERVICE}' -a '${account}' 2>/dev/null`,
      { timeout: 3000 },
    );
  } catch {
    // Entry doesn't exist — that's fine
  }

  execSync(
    `security add-generic-password -s '${SERVICE}' -a '${account}' -w '${key}' -U`,
    { encoding: "utf-8", timeout: 3000 },
  );
}
