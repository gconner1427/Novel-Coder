// Novel-writing persona, subagents and slash commands shared by both engines.

export const NOVEL_SYSTEM_APPEND = `
# Novel Coder mode
You are running inside **Novel Coder**, a writing studio for novelists. The working directory is a
novel project (see CLAUDE.md / AGENTS.md). Treat prose as the product: draft vivid, specific,
emotionally true fiction in the book's established voice, POV and tense.

- Use the \`novel\` MCP tools (project_overview, scene_list, scene_read, scene_write, bible_search,
  bible_get, bible_upsert, continuity_context, outline_get, timeline_add, report_write, snapshot_create)
  in preference to raw file edits when they fit. Plain file tools are fine for everything else.
- Before substantial rewrites call snapshot_create so the author can rewind.
- Keep the story bible current: new named characters, places and world rules get entries.
- When giving feedback, be candid and specific; quote the passage and explain the effect on a reader.
- Never pad, summarise instead of dramatise, or end scenes with tidy moralising unless asked.
`.trim()

export const BRAINSTORM_SYSTEM_APPEND = `
# Novel Coder brainstorm mode
You are running inside **Novel Coder**, a writing studio for novelists. The author is brainstorming a
book or series that doesn't exist yet. Follow CLAUDE.md / AGENTS.md in the working directory: be a
creative partner, ask a question or two at a time, offer specific options, and keep ideas.md current.
`.trim()

export interface SubagentDef {
  description: string
  prompt: string
  tools?: string[]
}

export const SUBAGENTS: Record<string, SubagentDef> = {
  'continuity-checker': {
    description: 'Checks scenes against the story bible, timeline and earlier chapters for contradictions (names, eye colour, ages, dates, geography, who-knows-what). Use for /continuity.',
    prompt:
      'You are a meticulous continuity editor. For the given scene(s): call continuity_context, read neighbouring scenes as needed, and list every inconsistency with file path, a quote, what it contradicts (cite the bible entry or earlier passage) and a suggested fix. Also list facts introduced that should be added to the bible. Save the report with report_write. Do not edit the manuscript.'
  },
  'line-editor': {
    description: 'Line-level prose editing: rhythm, clarity, word choice, filter words, repetition, dialogue tags. Use for /revise when the user wants polish.',
    prompt:
      'You are an exacting line editor. Improve sentence-level craft while preserving the author\'s voice (read the style guide first). Prefer targeted edits over rewrites. Explain notable changes briefly.'
  },
  'developmental-editor': {
    description: 'Big-picture critique: structure, pacing, stakes, character arcs, scene goals and conflict. Use for /critique.',
    prompt:
      'You are a developmental editor. Assess structure, pacing, stakes, character motivation and arc, scene goal/conflict/outcome, and how the text serves the outline. Give a prioritised list of revisions with reasons. Save the report with report_write.'
  },
  'beta-reader': {
    description: 'Reads like a target-audience reader and reports emotional reactions, confusion, boredom and delight moment by moment.',
    prompt:
      'You are a genre-savvy beta reader. Read the requested text and give an honest moment-by-moment reaction log (where you were hooked, confused, bored, moved), then overall impressions. Do not edit files.'
  }
}

export interface CommandDef {
  description: string
  args?: string
  /** Prompt template; $ARGUMENTS is replaced with user args. */
  prompt?: string
  /** Local commands are handled by the app, not sent to the engine. */
  local?: boolean
}

export const BUILTIN_COMMANDS: Record<string, CommandDef> = {
  // ---- writing ----
  draft: {
    description: 'Draft a scene from its outline/summary',
    args: '<scene path or description>',
    prompt:
      'Draft the scene: $ARGUMENTS\n\nFirst call continuity_context (or project_overview if the scene does not exist yet, then scene_create). Read the outline, the previous scene and relevant bible entries. Then write the full scene in the book\'s voice with scene_write, set status to "drafted" and write a one-sentence summary. Afterwards, add any new characters/places to the bible.'
  },
  continue: {
    description: 'Continue writing from where a scene leaves off',
    args: '<scene path> [how much / direction]',
    prompt:
      'Continue the scene $ARGUMENTS. Read it and its continuity context, then append the next passage with scene_write mode "append", matching voice and momentum exactly.'
  },
  revise: {
    description: 'Revise a scene or passage with specific goals',
    args: '<scene path> [goals]',
    prompt: 'Revise $ARGUMENTS. Snapshot first. Make targeted edits that achieve the goals, keep the author\'s voice, then set status to "revised" and summarise what you changed.'
  },
  critique: {
    description: 'Developmental critique of a scene, chapter or the whole book',
    args: '[scope]',
    prompt: 'Use the developmental-editor approach to critique: $ARGUMENTS (default: the whole manuscript so far). Save the report with report_write and summarise the top five issues here.'
  },
  continuity: {
    description: 'Check continuity against the bible and earlier chapters',
    args: '[scene path | chapter | all]',
    prompt: 'Run a continuity check on: $ARGUMENTS (default: all drafted scenes). Use the continuity-checker approach, save the report with report_write and list the problems here, most serious first.'
  },
  'line-edit': {
    description: 'Line-edit a passage for prose quality',
    args: '<scene path>',
    prompt: 'Line-edit $ARGUMENTS using the line-editor approach. Snapshot first, then make the edits.'
  },
  beta: {
    description: 'Get a beta-reader reaction log',
    args: '<scene path | chapter>',
    prompt: 'Act as a beta reader for $ARGUMENTS and give a moment-by-moment reaction log, then overall impressions.'
  },
  outline: {
    description: 'Build or refine the outline',
    args: '[instructions]',
    prompt: 'Work on the outline: $ARGUMENTS. Read outline/outline.md, outline/beats.md and the bible, then update the outline with outline_update. Propose scene-by-scene breakdown for the chapters if useful.'
  },
  beats: {
    description: 'Fill in or rework the beat sheet',
    args: '[instructions]',
    prompt: 'Fill in the beat sheet in outline/beats.md based on the outline and premise. $ARGUMENTS'
  },
  character: {
    description: 'Create or deepen a character bible entry',
    args: '<name> [notes]',
    prompt: 'Develop the character: $ARGUMENTS. Check the bible and manuscript for what is already established, then write a rich entry with bible_upsert (role, age, appearance, want, need, flaw, voice, backstory, arc). Do not contradict the manuscript.'
  },
  worldbuild: {
    description: 'Develop a location or piece of lore',
    args: '<topic>',
    prompt: 'Develop worldbuilding for: $ARGUMENTS. Check existing bible entries first, then write location or lore entries with bible_upsert.'
  },
  'bible-sync': {
    description: 'Update the story bible from the manuscript',
    args: '[scene path | chapter | all]',
    prompt: 'Read $ARGUMENTS (default: all scenes) and update the story bible: add missing characters/places/lore, record new facts, and add events to the timeline. Report what you changed.'
  },
  summarize: {
    description: 'Write summaries into scene frontmatter',
    args: '[scope]',
    prompt: 'For each scene in $ARGUMENTS (default: all scenes missing a summary), write a one or two sentence summary into its frontmatter with scene_write (keep the body unchanged).'
  },
  brainstorm: {
    description: 'Brainstorm ideas (plot, titles, twists, names…)',
    args: '<topic>',
    prompt: 'Brainstorm: $ARGUMENTS. Give a varied list of strong, specific options grounded in this book\'s premise and bible, then recommend your favourites and why. Do not edit files.'
  },
  'rename-character': {
    description: 'Rename a character everywhere (manuscript + bible)',
    args: '<old name> -> <new name>',
    prompt: 'Rename the character $ARGUMENTS everywhere: every scene, the bible entry (and its aliases), outline and timeline. Snapshot first. Watch out for possessives and nicknames. Report each file changed.'
  },
  'from-brainstorm': {
    description: 'Build out this project from the brainstorm that created it',
    prompt:
      'This project was just created from a brainstorm. Read notes/brainstorm-ideas.md and notes/brainstorm-conversation.md (and the conversation context you were given). Snapshot first, then set the project up from it:\n' +
      '1. Fill outline/outline.md (premise + acts) with outline_update, and outline/beats.md.\n' +
      '2. Create bible entries with bible_upsert for every character, location and piece of lore we discussed (for a series, use scope "series" for anything that recurs across books).\n' +
      '3. Fill the style guide (bible/style-guide.md, or ../bible/style-guide.md in a series) with the voice we discussed, and add timeline events.\n' +
      '4. If this is a series, write ../series-outline.md: the overarching arc and each planned book\'s core conflict and ending.\n' +
      '5. Create chapter and scene skeletons for Act I with scene_create, each with a one-sentence summary (rename or reuse the placeholder first scene).\n' +
      'Don\'t write prose yet. Finish with a short summary of what you set up and what is still undecided. $ARGUMENTS'
  },
  'series-plan': {
    description: 'Develop the series outline (arc across all books)',
    args: '[instructions]',
    prompt:
      'Work on the series plan: $ARGUMENTS. Call series_overview, read ../series-outline.md, ../SERIES.md and the series bible, then update ../series-outline.md with the overarching arc, each book\'s core conflict, ending and hook into the next, and which threads are planted where. Note any series-bible entries that should be added.'
  },
  'next-book': {
    description: 'Plan the next book in the series from what has been written',
    args: '[notes]',
    prompt:
      'Plan the next book in this series. $ARGUMENTS\nCall series_overview, read the series outline, the series bible and the scene summaries of the earlier books. Then propose the next book\'s premise, core conflict, character arcs, the threads it picks up and pays off, and a chapter-level outline. Don\'t create files yet; ask the author to click "Add book" in the Series panel when they are happy.'
  },
  // ---- harness (handled locally) ----
  help: { description: 'Show available commands', local: true },
  clear: { description: 'Start a new conversation', local: true },
  compact: { description: 'Summarise the conversation to free up context', local: true },
  engine: { description: 'Switch engine (claude | codex)', args: '<claude|codex>', local: true },
  model: { description: 'Set the model for the current engine', args: '<model>', local: true },
  plan: { description: 'Toggle plan mode (read-only planning)', local: true },
  snapshot: { description: 'Create a project snapshot', args: '[message]', local: true },
  rewind: { description: 'Open snapshots to rewind', local: true },
  export: { description: 'Export the manuscript', args: '[md|docx|epub|pdf]', local: true },
  wordcount: { description: 'Show word count and progress', local: true },
  goal: { description: 'Set daily word goal', args: '<words>', local: true },
  resume: { description: 'Browse past conversations', local: true },
  new: { description: 'Create a new novel or series project', local: true },
  'new-brainstorm': { description: 'Start a brainstorm chat (no project needed)', local: true },
  'add-book': { description: 'Add a new book to this series', args: '<title>', local: true },
  'make-series': { description: 'Turn this novel into book 1 of a series', args: '<series title>', local: true }
}

export function expandPrompt(template: string, args: string): string {
  return template.replace(/\$ARGUMENTS/g, args.trim() || '(not specified; use your judgement)')
}
