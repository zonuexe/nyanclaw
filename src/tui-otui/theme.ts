import { RGBA, SyntaxStyle } from "@opentui/core";

/**
 * Shared color palette for the OpenTUI-based nyanclaw UI.
 *
 * These mirror the accent colors used by the legacy pi-tui theme
 * (blue accents, dim gray secondary text) so the visual identity
 * stays consistent across the migration.
 */
export const palette = {
  accent: "#2f9bff", // primary blue (was 38;5;39)
  accentDim: "#5f87d7", // editor border (was 38;5;67)
  link: "#268bd2",
  dim: "#8a8a8a", // secondary text (was 38;5;245)
  faint: "#585858", // borders / hints (was 38;5;240)
  userPrompt: "#7dcfff",
  error: "#f7768e",
  bg: "#0d1117",
  bgAlt: "#161b22",
} as const;

/**
 * Syntax highlighting theme used by <markdown> and <code> renderables.
 * OpenTUI drives these through tree-sitter, so fenced code blocks in
 * assistant responses get real syntax highlighting (an upgrade over
 * the legacy single-color code styling).
 */
export const syntaxStyle: SyntaxStyle = SyntaxStyle.fromStyles({
  keyword: { fg: RGBA.fromHex("#c792ea"), bold: true },
  string: { fg: RGBA.fromHex("#c3e88d") },
  comment: { fg: RGBA.fromHex("#868e96"), italic: true },
  number: { fg: RGBA.fromHex("#f78c6c") },
  function: { fg: RGBA.fromHex("#82aaff") },
  type: { fg: RGBA.fromHex("#ffcb6b") },
  variable: { fg: RGBA.fromHex("#f07178") },
  operator: { fg: RGBA.fromHex("#89ddff") },
  default: { fg: RGBA.fromHex("#a6accd") },
});
