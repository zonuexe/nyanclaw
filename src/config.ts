export function logseqGraph(): string {
  const val = process.env.LOGSEQ_GRAPH;
  if (!val) {
    throw new Error(
      "LOGSEQ_GRAPH not set. Point it to your Logseq graph directory, e.g.\n" +
      "  export LOGSEQ_GRAPH=/path/to/logseq/graph",
    );
  }
  return val;
}

export function slidesDir(): string {
  const val = process.env.NYANCLAW_SLIDES_DIR;
  if (!val) {
    throw new Error(
      "NYANCLAW_SLIDES_DIR not set. Point it to your slides repository, e.g.\n" +
      "  export NYANCLAW_SLIDES_DIR=/path/to/slides",
    );
  }
  return val;
}

export const NYANCLAW_PROVIDER = process.env.NYANCLAW_PROVIDER ?? "opencode-go";
export const NYANCLAW_MODEL = process.env.NYANCLAW_MODEL ?? "deepseek-v4-flash";

