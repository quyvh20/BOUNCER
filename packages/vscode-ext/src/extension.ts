// FUTURE EXPANSION SKELETON: VS Code front-end for @bouncer/core.
// Shows the intelligence badge in the status bar and exposes the core engine as commands.
// No editor-agent integration yet: there is no VS Code API to intercept another extension's prompts.
import * as vscode from "vscode";
import { BouncerEngine, buildIntelligenceProfile, loadConfig, loadStats } from "@bouncer/core";

const SHORT_BADGE = { 1: "🥉 L1", 2: "🥈 L2", 3: "🥇 L3" } as const;

function workspaceCwd(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function refreshStatus(item: vscode.StatusBarItem): void {
  const config = loadConfig();
  const profile = buildIntelligenceProfile(config.provider);
  item.text = `$(shield) Bouncer ${SHORT_BADGE[profile.level]}`;
  item.tooltip = `${profile.badge}\n${profile.providerName} · ${profile.modelName}\nMode: ${config.mode}`;
}

export function activate(context: vscode.ExtensionContext): void {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = "bouncer.showStats";
  refreshStatus(status);
  status.show();

  context.subscriptions.push(
    status,

    vscode.commands.registerCommand("bouncer.checkPrompt", async () => {
      const cwd = workspaceCwd();
      if (!cwd) return void vscode.window.showWarningMessage("Bouncer: open a folder first.");
      const prompt = await vscode.window.showInputBox({ prompt: "Prompt to check with Bouncer" });
      if (!prompt) return;
      // Advisory only: never persist stats or touch the clipboard from the editor preview.
      const engine = new BouncerEngine({ persist: false, config: { clipboardEnabled: false } });
      const result = await engine.evaluate({ platform: "vscode", prompt, cwd });
      if (result.action === "block") {
        void vscode.window.showWarningMessage(result.reason ?? "Bouncer would block this prompt.");
      } else {
        const hints = result.highConfidenceHints.length ? ` · start with ${result.highConfidenceHints.join(", ")}` : "";
        void vscode.window.showInformationMessage(`Bouncer: ${result.complexity} → ${result.usageBudget.recommendedModel} / ${result.usageBudget.recommendedEffort}${hints}`);
      }
    }),

    vscode.commands.registerCommand("bouncer.rescue", async () => {
      const cwd = workspaceCwd();
      if (!cwd) return void vscode.window.showWarningMessage("Bouncer: open a folder first.");
      const pkg = await new BouncerEngine({ config: { clipboardEnabled: false } }).rescue(cwd);
      await vscode.env.clipboard.writeText(pkg.markdown);
      const doc = await vscode.workspace.openTextDocument({ content: pkg.markdown, language: "markdown" });
      await vscode.window.showTextDocument(doc, { preview: true });
      void vscode.window.showInformationMessage("Bouncer: rescue handover copied to clipboard.");
    }),

    vscode.commands.registerCommand("bouncer.showStats", () => {
      refreshStatus(status);
      const s = loadStats();
      void vscode.window.showInformationMessage(
        `Bouncer: ${s.promptsEvaluated} prompts · ${s.promptsBlocked} blocked · ~${s.tokensSavedEstimate.toLocaleString()} tokens saved · ${s.rescuesGenerated} rescues`,
      );
    }),
  );
}

export function deactivate(): void {}
