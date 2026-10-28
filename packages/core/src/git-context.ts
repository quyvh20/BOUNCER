import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

/** Runs `git <args>` in a directory; returns stdout or null on failure. Injectable for tests. */
export type GitRunner = (args: string[], cwd: string) => string | null;

export const defaultGitRunner: GitRunner = (args, cwd) => {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
  } catch {
    return null;
  }
};

/** Checks a repo-relative path physically exists. Injectable for tests. */
export type FileExists = (repoRelativePath: string, root: string) => boolean;

export const defaultFileExists: FileExists = (p, root) => existsSync(join(root, p));

export interface GitContextOptions {
  runner?: GitRunner;
  fileExists?: FileExists;
}

/** Normalise a path to forward-slash, repo-relative form (strips leading @, ./, quotes). */
export function normalizeRepoPath(p: string, root?: string): string {
  let out = p.trim().replace(/^@/, "").replace(/^["'`]|["'`]$/g, "").replace(/\\/g, "/");
  if (root && isAbsolute(out)) out = relative(root, out).replace(/\\/g, "/");
  return out.replace(/^\.\//, "");
}

/**
 * Ground-truth view of the workspace. Every file Bouncer ever recommends must pass
 * through `validateFiles` (Safety Law 1): present in `git ls-files` AND on disk.
 */
export class GitContext {
  private readonly runner: GitRunner;
  private readonly fileExists: FileExists;
  private rootCache?: string | null;
  private lsFilesCache?: string[];
  private lsFilesSetCache?: Set<string>;
  private statusCache?: string;

  constructor(
    readonly cwd: string,
    options: GitContextOptions = {},
  ) {
    this.runner = options.runner ?? defaultGitRunner;
    this.fileExists = options.fileExists ?? defaultFileExists;
  }

  private git(args: string[]): string | null {
    return this.runner(args, this.cwd);
  }

  isRepo(): boolean {
    return this.root() !== null;
  }

  /** Absolute repository root, or null outside a git repo. */
  root(): string | null {
    if (this.rootCache === undefined) {
      const out = this.git(["rev-parse", "--show-toplevel"]);
      this.rootCache = out ? out.trim() : null;
    }
    return this.rootCache;
  }

  branch(): string | undefined {
    const out = this.git(["rev-parse", "--abbrev-ref", "HEAD"]);
    const name = out?.trim();
    if (name && name !== "HEAD") return name;
    // Unborn branch (no commits yet) or detached HEAD.
    return this.git(["symbolic-ref", "--short", "HEAD"])?.trim() || name || undefined;
  }

  /** `git status --short` verbatim. */
  statusShort(): string {
    if (this.statusCache === undefined) {
      this.statusCache = (this.git(["status", "--short", "--untracked-files=all"]) ?? "").replace(/\s+$/, "");
    }
    return this.statusCache;
  }

  /** `git diff --stat` against HEAD (staged + unstaged), verbatim. */
  diffStat(): string {
    const vsHead = this.git(["diff", "HEAD", "--stat"]);
    if (vsHead !== null) return vsHead.replace(/\s+$/, "");
    // Repo without commits: fall back to staged changes.
    return (this.git(["diff", "--cached", "--stat"]) ?? "").replace(/\s+$/, "");
  }

  /** Files currently modified/added/untracked according to `git status`. Deletions are excluded. */
  modifiedFiles(): string[] {
    const files: string[] = [];
    for (const line of this.statusShort().split(/\r?\n/)) {
      if (line.length < 4) continue;
      const code = line.slice(0, 2);
      if (code.includes("D")) continue;
      let path = line.slice(3);
      const arrow = path.indexOf(" -> ");
      if (arrow !== -1) path = path.slice(arrow + 4); // renames: keep the new path
      files.push(normalizeRepoPath(path));
    }
    return [...new Set(files)];
  }

  /** Tracked + untracked-but-not-ignored files (`git ls-files -co --exclude-standard`). */
  lsFiles(): string[] {
    if (!this.lsFilesCache) {
      const out = this.git(["ls-files", "--cached", "--others", "--exclude-standard"]) ?? "";
      this.lsFilesCache = out
        .split(/\r?\n/)
        .map((l) => normalizeRepoPath(l))
        .filter(Boolean);
    }
    return this.lsFilesCache;
  }

  lsFilesSet(): Set<string> {
    this.lsFilesSetCache ??= new Set(this.lsFiles());
    return this.lsFilesSetCache;
  }

  /**
   * SAFETY LAW 1: keep only files that are in `git ls-files` AND physically exist.
   * Order is preserved, duplicates removed. Anything else (hallucinations) is stripped.
   */
  validateFiles(candidates: string[]): string[] {
    const root = this.root();
    if (!root) return [];
    const known = this.lsFilesSet();
    const out: string[] = [];
    for (const c of candidates) {
      if (typeof c !== "string") continue;
      const p = normalizeRepoPath(c, root);
      if (!p || p.startsWith("../") || out.includes(p)) continue;
      if (known.has(p) && this.fileExists(p, root)) out.push(p);
    }
    return out;
  }

  /**
   * Paths shown to the BYOK classifier. Big repos have thousands of files, so a plain "first 40" would
   * usually miss the right one: modified files come first, then paths ranked by overlap with the prompt.
   */
  workspaceSample(limit = 40, prompt = ""): string[] {
    const modified = this.modifiedFiles();
    const words = promptWords(prompt);
    const scored = this.lsFiles()
      .filter((f) => !modified.includes(f))
      .map((f, i) => ({ f, i, score: pathScore(f, words) }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.f);
    return [...modified, ...scored].slice(0, limit);
  }
}

function promptWords(prompt: string): string[] {
  return [...new Set(prompt.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3))];
}

/** Count prompt words that match (or prefix-match) a path segment; file names weigh double. */
function pathScore(path: string, words: string[]): number {
  if (!words.length) return 0;
  const parts = path.toLowerCase().split("/");
  const fileSegs = (parts.pop() ?? "").split(/[^a-z0-9]+/).filter(Boolean);
  const dirSegs = parts.flatMap((p) => p.split(/[^a-z0-9]+/)).filter(Boolean);
  const hit = (segs: string[], w: string) => segs.some((s) => s === w || (s.length >= 4 && w.length >= 4 && (s.startsWith(w) || w.startsWith(s))));
  let score = 0;
  for (const w of words) {
    if (hit(fileSegs, w)) score += 2;
    else if (hit(dirSegs, w)) score += 1;
  }
  return score;
}
