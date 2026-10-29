// One recognisable format for everything Bouncer tells the user when it stops a prompt:
// a branded title, two or three plain lines, and the next step in big letters.

/** The paste shortcut for this machine. */
export const PASTE_KEY = process.platform === "darwin" ? "⌘ + V" : "CTRL + V";

const RULE = "─".repeat(46);

export interface BouncerNotice {
  /** Emoji + short uppercase title, e.g. "🌱 FRESH START RECOMMENDED". */
  title: string;
  body: string[];
  /** The one thing to do, rendered in capitals with arrows between steps. */
  steps?: string[];
  /** Whether re-sending with " !" gets the prompt through (false for secrets). */
  canOverride?: boolean;
  /** The question before the " !" hint, e.g. "Want to stay in this session?". */
  overrideAsk?: string;
}

export function formatNotice(n: BouncerNotice): string {
  const out = [`🕶️ BOUNCER  ·  ${n.title}`, RULE, ...n.body];
  if (n.steps?.length) out.push("", `   👉  ${n.steps.map(shout).join("   →   ")}   →   DONE !`);
  if (n.canOverride !== false) out.push("", `${n.overrideAsk ?? "Prefer to send it as is?"} Re-send your prompt ending with " !".`);
  return out.join("\n");
}

/** Capitalise a step, except `backticked` commands, which must stay typeable. */
function shout(step: string): string {
  return step
    .split(/(`[^`]+`)/)
    .map((part) => (part.startsWith("`") ? part.slice(1, -1) : part.toUpperCase()))
    .join("");
}

export function newSessionStep(clearCommand: string): string {
  return `open a new session ( \`${clearCommand}\` )`;
}

export function pasteStep(): string {
  return `press ${PASTE_KEY}`;
}
