import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

/**
 * Atomic write: temp outside *.org page pattern when possible.
 * Prefer same-volume tmpdir; fallback to dotfile in target dir.
 */
export function readOrgFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

export function writeOrgFileAtomic(path: string, content: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const token = randomBytes(6).toString("hex");
  const pid = process.pid;
  let tmpPath: string;
  let useTmpdir = true;

  try {
    tmpPath = join(tmpdir(), `.nyanclaw-write-${pid}-${token}`);
    writeFileSync(tmpPath, content, "utf-8");
    try {
      renameSync(tmpPath, path);
      return;
    } catch {
      // cross-device rename — fall through
      try {
        unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
      useTmpdir = false;
    }
  } catch {
    useTmpdir = false;
  }

  if (!useTmpdir) {
    tmpPath = join(dir, `.nyanclaw-write-${pid}-${token}`);
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, path);
  }
}

export function mtimeMs(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}
