# Novel Coder

An agentic writing studio for novelists, for Windows. It works like the Claude Code and Codex desktop apps, but it is built for fiction. Under the hood it runs **Claude Code** (through the Claude Agent SDK) and **OpenAI Codex** (through the Codex SDK). You sign in to each with your own account, so usage counts against your own Claude or ChatGPT plan.

Novel Coder is an independent project. It is not made, endorsed or supported by Anthropic or OpenAI.

## Install

1. Download `Novel-Coder-Setup-<version>.exe` from the [latest release](https://github.com/gconner1427/Novel-Coder/releases/latest) and run it. The app isn't code-signed yet, so Windows SmartScreen may warn you; click **More info → Run anyway**.
2. **To use Claude:** install Claude Code from Anthropic ([setup guide](https://code.claude.com/docs/en/setup)) and sign in to it. Novel Coder doesn't include Claude Code; it finds your own installation, whether from Anthropic's installer, npm, or the Claude Code VS Code extension.
3. **To use Codex:** Codex is included. Sign in with **Settings → Accounts → Log in**, which runs `codex login`.

If you already use Claude Code or the Codex CLI on this PC, you're already signed in. Sign-in always goes through Anthropic's and OpenAI's own login pages; Novel Coder never sees or stores your credentials.

## Features

**Agent harness (both engines)**
- Streaming chat with collapsible thinking, tool-call cards and word-level diffs. Each file change has a **Revert** button.
- Engine toggle in the title bar (Claude ⇄ Codex). Switching mid-conversation hands the transcript over to the other engine.
- Model and effort pickers, and permission modes: Ask before edits, Auto-accept edits, Plan mode, Full auto.
  - Claude: per-tool permission prompts, plan approval cards, and clarifying-question cards.
- Subagents: continuity-checker, blocking-checker, line-editor, developmental-editor, beta-reader.
- Todo/plan panel, Esc to interrupt, conversation history and resume, image attachments, `@file` mentions.
- Everything else the engines can do still works (web search, shell, MCP servers in your own config, and so on).

**Brainstorm before a project exists**
- From the start screen, choose **Brainstorm with Claude** or **Brainstorm with Codex** to talk an idea through with no project.
- The AI keeps a live `ideas.md` panel up to date: working title, standalone or series, genre, POV, tense, premise, characters, world and open questions.
- **Turn into a book / series** creates the project, pre-filled from those notes.
  - It then runs `/from-brainstorm`: the AI builds the outline, story bible, style guide, series plan and Act I scene skeletons from the conversation.
  - The conversation and ideas are saved in `notes/`.
- Past brainstorms are listed on the start screen so you can come back to them later.

**Series**
- Create a **Series** from New Novel, turn a brainstorm into one, or convert an existing novel (Settings → Turn into a series, or `/make-series`).
- On disk, a series folder contains:
  - `series.json`
  - `SERIES.md` (series instructions for the AI)
  - `series-outline.md`
  - a shared **series bible** (`bible/`: recurring characters, places, lore, series timeline and style guide)
  - one normal book folder per book
- **Series panel:** switch books, add the next book, edit series settings and track progress. AI actions: develop the series arc (`/series-plan`), plan the next book (`/next-book`), and run a series continuity check.
- Each book has its own bible for book-only characters. The bible panel marks entries as *series* or *book*, and the AI uses `bible_upsert` with `scope: "series"` for anything recurring.
- Both engines get access to the series folder. `series_overview` and `continuity_context` include earlier books' summaries, so later books stay consistent.
- Snapshots of a series book cover the whole series folder.

**Writing tools**
- **Manuscript:** a chapter/scene tree with drag-to-reorder and scene status (idea → final). The prose editor supports focus mode and book-style indents and autosaves.
- **Scene metadata:** POV, location, time, characters, summary.
- **Story bible:** characters, locations, lore, timeline and style guide, all editable as forms.
- **Outline and beat sheets:** Save the Cat, Three-Act or Hero's Journey; plus a corkboard.
- **Novel MCP server**, available to both engines: `project_overview`, `scene_read/write/create/list`, `bible_get/search/upsert`, `continuity_context`, `outline_get/update`, `timeline_add`, `report_write`, `snapshot_create`, `word_count`.
- **Slash commands:** `/draft`, `/continue`, `/revise`, `/line-edit`, `/critique`, `/continuity`, `/blocking`, `/beta`, `/outline`, `/beats`, `/character`, `/worldbuild`, `/bible-sync`, `/summarize`, `/brainstorm`, `/rename-character`.
  - App commands: `/engine`, `/model`, `/plan`, `/compact`, `/clear`, `/snapshot`, `/rewind`, `/export`, `/wordcount`, `/goal`, `/resume`, `/help`.
  - Add your own commands as `.novel/commands/*.md`.
- **Snapshots & rewind:** a hidden Git history in `.novel/history`. Codex turns are checkpointed automatically, and you can roll back the whole project.
- **Progress:** daily word goal, streak, a 30-day chart, a finish estimate, and per-chapter counts.
- **Export:** DOCX (standard manuscript format), EPUB, PDF and Markdown.

## A novel project on disk

```
My Novel/
  novel.json          title, POV, tense, goals, default engine
  NOVEL.md            your standing instructions to the AI (mirrored to CLAUDE.md + AGENTS.md)
  manuscript/01-chapter-one/01-opening.md   scenes (YAML frontmatter + prose)
  bible/characters|locations|lore/*.md, bible/timeline.md, bible/style-guide.md
  outline/outline.md, outline/beats.md, notes/
  .novel/             sessions, stats, reports, custom commands, snapshots
```

## Develop

```
npm install
npm run dev          # run the app with hot reload
npm test             # unit and MCP tests
npm run dist         # build dist/Novel-Coder-Setup-<version>.exe
```

Opt-in tests:
- `LIVE=1` runs the live engine tests (they use a little of your plan's quota).
- `E2E=1` runs the Electron UI tests. Add `E2E_LIVE=1` to include live chat, and `E2E_EXE=dist/win-unpacked/NovelCoder.exe` to test the packaged build.

If you launch from a VS Code terminal, unset `ELECTRON_RUN_AS_NODE` first; VS Code sets it, and it makes Electron start as plain Node.

Novel Coder is for personal use with your own subscription logins.
