import { useEffect, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, BookOpen, Swords } from 'lucide-react'
import { api, type UniverseOverview as Overview } from '../../lib/api'
import { useStore } from '../../store'
import { FORMAT_NAME } from '../sidebar/UniversePanel'

/** The universe at a glance: reading order, every timeline in that order, and who appears where. */
export function UniverseOverview() {
  const project = useStore((s) => s.project)!
  const openBook = useStore((s) => s.openBook)
  const openTab = useStore((s) => s.openTab)
  const notify = useStore((s) => s.notify)
  const [ov, setOv] = useState<Overview | null>(null)

  useEffect(() => {
    let live = true
    const t = setTimeout(() => void api.universe.overview().then((o) => live && setOv(o ?? null)), ov ? 700 : 0)
    return () => {
      live = false
      clearTimeout(t)
    }
    // Reload when the project changes (a save, a new book, a reorder); the first load is immediate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  if (!project.universe) return <div className="desk h-full p-10 text-muted">This book is not part of a universe.</div>
  if (!ov) return <div className="desk h-full" />

  const move = async (i: number, d: -1 | 1) => {
    const books = [...ov.books]
    const j = i + d
    if (j < 0 || j >= books.length) return
    ;[books[i], books[j]] = [books[j], books[i]]
    setOv({ ...ov, books })
    try {
      await api.universe.setReadingOrder(books.map((b) => b.key))
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }
  const attempt = (fn: () => Promise<void>) => void fn().catch((e) => notify((e as Error).message, 'error'))
  const shown = ov.appearances.entries.map((e, i) => ({ e, row: ov.appearances.counts[i] })).filter((x) => x.row.some((n) => n > 0) || ov.appearances.entries.length <= 12)

  return (
    <div className="desk h-full overflow-y-auto" data-testid="universe-overview">
      <div className="mx-auto max-w-[960px] px-10 pb-16 pt-10">
        <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.015em]" style={{ fontFamily: 'var(--font-prose)' }}>
          {ov.universe}
        </h1>
        <p className="mb-7 mt-1 text-[12.5px] text-faint">
          Universe overview · {ov.books.length} {ov.books.length === 1 ? 'book' : 'books'} · {ov.books.reduce((a, b) => a + b.words, 0).toLocaleString()} words
        </p>

        <Card title="Reading order" hint="The order readers should read every book in, across series and standalones. The AI follows it too.">
          <ol>
            {ov.books.map((b, i) => (
              <li key={b.key} className="group flex items-center gap-3 border-b border-line py-2 last:border-0">
                <span className="w-6 shrink-0 text-right text-[13px] tabular-nums text-faint">{i + 1}</span>
                <button
                  className={`min-w-0 flex-1 text-left ${b.current ? 'cursor-default' : 'hover:text-accent'}`}
                  disabled={b.current}
                  title={b.current ? 'The book you have open' : `Open ${b.title}`}
                  onClick={() => attempt(() => openBook(b.root))}
                >
                  <span className={`block truncate text-[13.5px] ${b.current ? 'font-semibold' : 'font-medium'}`}>
                    {b.title}
                    {b.current && <span className="ml-2 text-[11px] font-normal text-accent">open</span>}
                  </span>
                  <span className="block truncate text-[11.5px] text-faint">
                    {[b.seriesTitle ? `${b.seriesTitle}, book ${b.number}` : 'Standalone', b.format !== 'novel' ? FORMAT_NAME[b.format] : null, `${b.words.toLocaleString()} words`].filter(Boolean).join(' · ')}
                  </span>
                </button>
                {b.crossover && (
                  <span className="flex shrink-0 items-center gap-1 rounded bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent" title="Crossover event and part">
                    <Swords size={11} /> {b.crossover.event} {b.crossover.part}
                  </span>
                )}
                <span className="flex shrink-0 gap-0.5 opacity-40 group-hover:opacity-100">
                  <button className="icon-btn h-6 w-6" title="Read earlier" aria-label={`Move ${b.title} earlier`} disabled={i === 0} onClick={() => void move(i, -1)}>
                    <ArrowUp size={13} />
                  </button>
                  <button className="icon-btn h-6 w-6" title="Read later" aria-label={`Move ${b.title} later`} disabled={i === ov.books.length - 1} onClick={() => void move(i, 1)}>
                    <ArrowDown size={13} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Who appears where" hint="Scenes in each book that list or mention each entry in the universe bible. Columns follow the reading order.">
          {ov.appearances.entries.length === 0 ? (
            <p className="text-[12.5px] text-faint">The universe bible has no entries yet. Characters, teams and places that cross between series go there.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <th className="pb-2 pr-3 text-left font-medium text-faint" />
                    {ov.books.map((b, i) => (
                      <th key={b.key} className="w-9 pb-2 text-center font-medium tabular-nums text-faint" title={b.title}>
                        {i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ e, row }) => (
                    <tr key={e.path} className="border-t border-line">
                      <td className="max-w-[220px] py-1.5 pr-3">
                        <button className="block max-w-full truncate text-left hover:text-accent" onClick={() => openTab({ kind: 'file', path: e.path })} title={`Open ${e.name}`}>
                          {e.name}
                        </button>
                      </td>
                      {row.map((n, bi) => (
                        <td key={bi} className="text-center" title={`${e.name} in ${ov.books[bi].title}: ${n} ${n === 1 ? 'scene' : 'scenes'}`}>
                          {n > 0 ? (
                            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent/20 px-1 text-[11px] font-medium tabular-nums text-accent">{n}</span>
                          ) : (
                            <span className="text-line-strong">·</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length < ov.appearances.entries.length && (
                <p className="mt-2 text-[11.5px] text-faint">{ov.appearances.entries.length - shown.length} universe entries don't appear in any scene yet.</p>
              )}
            </div>
          )}
        </Card>

        <Card title="Timelines" hint="The universe timeline, then each series and book timeline in reading order.">
          {ov.chronicle.length === 0 ? (
            <p className="text-[12.5px] text-faint">No timeline events yet. Add them to the universe timeline, or ask the AI to update the bible from the manuscript.</p>
          ) : (
            ov.chronicle.map((c) => (
              <div key={c.path} className="mb-5 last:mb-0">
                <button className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold hover:text-accent" onClick={() => openTab({ kind: 'file', path: c.path })}>
                  <BookOpen size={13} className="text-faint" /> {c.source}
                </button>
                <table className="w-full border-collapse text-[12.5px]">
                  <tbody>
                    {c.rows.map((r, i) => (
                      <tr key={i} className="border-t border-line align-top">
                        <td className="w-[22%] py-1.5 pr-3 text-muted">{r.when}</td>
                        <td className="py-1.5 pr-3">{r.event}</td>
                        <td className="w-[22%] py-1.5 text-faint">{r.where}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  )
}

function Card({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="mb-5 rounded-2xl border border-line-strong bg-panel px-6 pb-4 pt-5" style={{ boxShadow: 'var(--shadow-sm)' }}>
      <div className="text-[14px] font-semibold">{title}</div>
      <p className="mb-3 mt-0.5 text-[12px] text-faint">{hint}</p>
      {children}
    </section>
  )
}
