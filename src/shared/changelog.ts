// What's new in each version. Shown once on the first run of a new version, and from
// Settings any time. Add new features to the upcoming version's entry as they are built;
// the entry's version must match package.json when it is released.

export interface ChangelogItem {
  title: string
  body: string
}

export interface ChangelogEntry {
  version: string
  /** One line under the version heading. */
  summary: string
  items: ChangelogItem[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.2.0',
    summary: 'Your AI and chats follow you between devices, plus a blocking check for scenes.',
    items: [
      {
        title: 'Work on any of your devices',
        body:
          "The AI's memory and your chats are now kept in each book's folder (.novel/ai). If your books are in cloud storage, switch from your desktop to your laptop, open the book, and carry on where you left off: the AI remembers what it learned about you and the book, and your chats resume with their full context. Novel Coder saves after every reply and picks things up when you open a book. See Settings → Devices & AI memory for Save now, Load now and the AI's memory notes."
      },
      {
        title: 'One memory for both AIs',
        body: 'Claude and Codex now share the same memory notes for each book, so what you tell one, the other knows too.'
      },
      {
        title: 'Blocking check',
        body:
          'A new Blocking button sits above every scene (or type /blocking). The AI goes through the scene line by line, tracking where everyone is, which way they face and what is in each hand, and flags infinite hands, teleporting, forgotten characters, impossible reach, and anything the point-of-view character could not plausibly see, hear or know. You get a report with fixes; your scene is not changed until you say so.'
      },
      {
        title: "What's new",
        body: "This window. It appears the first time you open a new version, and you can bring it back any time from Settings → What's new."
      },
      {
        title: 'Tidier scene toolbar',
        body: 'The buttons above a scene fold down to icons and wrap when the window is narrow, so none get pushed off the edge.'
      }
    ]
  },
  {
    version: '0.1.2',
    summary: 'Updates install only when you choose.',
    items: [
      {
        title: 'You decide when to update',
        body: 'A downloaded update now installs only when you click Restart and update. Closing Novel Coder leaves it waiting.'
      }
    ]
  },
  {
    version: '0.1.1',
    summary: 'Updates from inside the app.',
    items: [
      {
        title: 'In-app updates',
        body: 'Novel Coder checks for a new release each time it opens. A bar at the top offers the update, and Settings → Updates lets you check any time.'
      },
      {
        title: 'Chat pickers fixed',
        body: 'The mode, model and effort pickers under the chat box open and work again.'
      }
    ]
  },
  {
    version: '0.1.0',
    summary: 'The first public version.',
    items: [
      {
        title: 'Write with Claude or Codex',
        body: 'Chat with either engine on your own account, switch between them mid-conversation, and review every change before or after it happens.'
      },
      {
        title: 'Everything for a novel',
        body: 'Chapters and scenes, a story bible, outline and beat sheets, a corkboard, continuity checks, editorial reports, snapshots and rewind, goals and streaks, and export to Word, EPUB, PDF and Markdown.'
      },
      {
        title: 'Brainstorms and series',
        body: 'Talk an idea through before a book exists and turn it into a project, or plan a whole series with a shared story bible.'
      }
    ]
  }
]

/** Compare two x.y.z versions: negative if a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

/**
 * The entries to show when `current` runs for the first time after `lastSeen`: every version newer than
 * lastSeen up to and including current (so skipped updates are covered too), newest first. With no
 * lastSeen (a fresh install), just the current version.
 */
export function entriesSince(current: string, lastSeen?: string): ChangelogEntry[] {
  if (!lastSeen) return CHANGELOG.filter((e) => e.version === current)
  return CHANGELOG.filter((e) => compareVersions(e.version, lastSeen) > 0 && compareVersions(e.version, current) <= 0)
}
