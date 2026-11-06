// Detect whether the Claude Code and Codex engines are installed and logged in, and launch logins.
//
// Claude Code is NOT bundled with Novel Coder: each user installs it from Anthropic and signs in
// through Anthropic's own flow. Novel Coder only runs that unmodified program. Codex (Apache-2.0)
// is bundled.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import type { AuthStatus } from '@shared/types'
import { resolvePackageFile } from '../engines/engine'

export const CLAUDE_INSTALL_URL = 'https://code.claude.com/docs/en/setup'

function onPath(cmd: string): string[] {
  try {
    const out = execFileSync('where.exe', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  } catch {
    return []
  }
}

const isFile = (p: string | undefined): p is string => {
  try {
    return !!p && fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * The user's own Claude Code executable, wherever they installed it:
 * CLAUDE_CODE_PATH, Anthropic's native installer, npm (via the PATH shim), or the VS Code extension.
 */
export function claudeExe(): string | undefined {
  const home = os.homedir()
  const candidates: (string | undefined)[] = [process.env.CLAUDE_CODE_PATH, path.join(home, '.local', 'bin', 'claude.exe')]
  for (const hit of onPath('claude')) {
    if (/\.exe$/i.test(hit)) candidates.push(hit)
    // npm installs a shim next to node_modules; the real program is in the package's bin folder.
    else candidates.push(path.join(path.dirname(hit), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'))
  }
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'))
  // Claude Code's VS Code extension carries its own copy.
  const ext = path.join(home, '.vscode', 'extensions')
  try {
    for (const d of fs.readdirSync(ext).filter((n) => n.startsWith('anthropic.claude-code')).sort().reverse())
      candidates.push(path.join(ext, d, 'resources', 'native-binary', 'claude.exe'))
  } catch {
    /* no VS Code */
  }
  return candidates.find(isFile)
}

export function codexExe(): string | undefined {
  return onPath('codex').find((p) => /\.(cmd|exe)$/i.test(p)) ?? resolvePackageFile('@openai/codex-win32-x64', 'vendor/x86_64-pc-windows-msvc/bin/codex.exe')
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
      loggedIn: !!cExe && claudeLogged,
      detail: !cExe
        ? 'Claude Code is not installed. Install it from Anthropic, then click Refresh.'
        : claudeLogged
          ? 'Signed in with your Claude account'
          : 'Not signed in. Click "Log in to Claude".'
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
  if (!exe) throw new Error(engine === 'claude' ? 'Claude Code is not installed. Install it from Anthropic first.' : 'Codex was not found.')
  const title = engine === 'claude' ? 'Log in to Claude' : 'Log in to ChatGPT (Codex)'
  const cmdline = engine === 'claude' ? `"${exe}" auth login || "${exe}"` : `"${exe}" login`
  spawn('cmd.exe', ['/c', 'start', `"${title}"`, 'cmd.exe', '/k', cmdline], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref()
}
