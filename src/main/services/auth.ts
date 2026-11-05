// Detect whether the Claude Code and Codex engines are installed and logged in, and launch logins.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import type { AuthStatus } from '@shared/types'
import { resolvePackageFile } from '../engines/engine'

function onPath(cmd: string): string | undefined {
  try {
    const out = execFileSync('where.exe', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    return out.split(/\r?\n/).find((l) => /\.(cmd|exe)$/i.test(l.trim()))?.trim() ?? out.split(/\r?\n/)[0]?.trim()
  } catch {
    return undefined
  }
}

export function claudeExe(): string | undefined {
  return onPath('claude') ?? resolvePackageFile('@anthropic-ai/claude-agent-sdk-win32-x64', 'claude.exe')
}

export function codexExe(): string | undefined {
  return onPath('codex') ?? resolvePackageFile('@openai/codex-win32-x64', 'vendor/x86_64-pc-windows-msvc/bin/codex.exe')
}

export function getAuthStatus(): AuthStatus {
  const claudeConfig = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')
  const codexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex')
  const cExe = claudeExe()
  const xExe = codexExe()
  const claudeLogged =
    fs.existsSync(path.join(claudeConfig, '.credentials.json')) || !!process.env.CLAUDE_CODE_OAUTH_TOKEN || !!process.env.ANTHROPIC_API_KEY
  const codexLogged = fs.existsSync(path.join(codexHome, 'auth.json')) || !!process.env.OPENAI_API_KEY
  return {
    claude: {
      installed: !!cExe,
      loggedIn: claudeLogged,
      detail: claudeLogged ? 'Signed in with your Claude account' : 'Not signed in. Click "Log in to Claude".'
    },
    codex: {
      installed: !!xExe,
      loggedIn: codexLogged,
      detail: codexLogged ? 'Signed in with your ChatGPT account' : 'Not signed in. Click "Log in to ChatGPT".'
    }
  }
}

/** Opens a console window running the engine's own login flow (browser OAuth with your subscription). */
export function launchLogin(engine: 'claude' | 'codex'): void {
  const exe = engine === 'claude' ? claudeExe() : codexExe()
  if (!exe) throw new Error(`${engine} CLI not found`)
  const title = engine === 'claude' ? 'Log in to Claude' : 'Log in to ChatGPT (Codex)'
  // Claude: running `claude` then typing /login; `claude auth login` on newer CLIs. Codex: `codex login`.
  const cmdline = engine === 'claude' ? `"${exe}" auth login || "${exe}"` : `"${exe}" login`
  spawn('cmd.exe', ['/c', 'start', `"${title}"`, 'cmd.exe', '/k', cmdline], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref()
}
