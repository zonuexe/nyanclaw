# ADR-0004: Logseq graph as the universal store (including machine-facing files)

NyanClaw is a thinking-and-record sidecar *and* a task agent, but it must not grow a second durable knowledge tree beside Logseq. **All durable state that belongs to the operator's knowledge surface lives in the file-based Logseq Org graph** — tasks, journals, decisions, proposals, session evidence, and other machine-oriented pages the human may not open daily. A separate `~/.nyanclaw/memory/**` Markdown SoT was rejected to avoid dual-write and "which is truth?" drift. Transient runtime config (API keys, model profiles) may remain outside the graph; search indexes may be derived caches only if they can be rebuilt from Logseq files.

**Write policy is dual-track**: task/journal mutations may apply immediately through structured Org ops; **Record learning stays draft-then-apply** so conversations do not silently rewrite durable knowledge. This is not “full autonomy” and not “observe-only for everything.”
