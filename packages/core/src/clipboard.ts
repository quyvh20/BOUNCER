import { spawn } from "node:child_process";

export type ClipboardWriter = (text: string) => Promise<boolean>;

interface ClipboardCommand {
  cmd: string;
  args: string[];
  encode: (text: string) => Buffer;
}

const utf8 = (text: string) => Buffer.from(text, "utf8");
// clip.exe interprets stdin with the console code page unless it sees a UTF-16LE BOM.
const utf16le = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);

function candidates(): ClipboardCommand[] {
  switch (process.platform) {
    case "darwin":
      return [{ cmd: "pbcopy", args: [], encode: utf8 }];
    case "win32":
      return [{ cmd: "clip", args: [], encode: utf16le }];
    default:
      return [
        { cmd: "wl-copy", args: [], encode: utf8 },
        { cmd: "xclip", args: ["-selection", "clipboard"], encode: utf8 },
        { cmd: "xsel", args: ["--clipboard", "--input"], encode: utf8 },
      ];
  }
}

function tryCommand(c: ClipboardCommand, text: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    let child;
    try {
      child = spawn(c.cmd, c.args, { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
    } catch {
      return done(false);
    }
    const timer = setTimeout(() => {
      child.kill();
      done(false);
    }, timeoutMs);
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
    child.stdin.on("error", () => done(false));
    child.stdin.end(c.encode(text));
  });
}

/**
 * Copy text to the system clipboard (pbcopy / clip / wl-copy / xclip / xsel).
 * Resolves false instead of throwing when no clipboard is available.
 * Set BOUNCER_NO_CLIPBOARD=1 to disable (CI, tests, headless boxes).
 */
export const copyToClipboard: ClipboardWriter = async (text) => {
  if (process.env.BOUNCER_NO_CLIPBOARD) return false;
  for (const c of candidates()) {
    if (await tryCommand(c, text, 2000)) return true;
  }
  return false;
};
