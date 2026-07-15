import type { SessionRecorder } from "./store.ts";

/** Process-wide active TUI session (evidence id for /capture provenance). */
let current: SessionRecorder | null = null;

export function setCurrentSession(session: SessionRecorder | null): void {
  current = session;
}

export function getCurrentSession(): SessionRecorder | null {
  return current;
}

export function getCurrentSessionId(): string | undefined {
  return current?.id;
}
