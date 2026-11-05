// Manuscript export: Markdown, DOCX (standard manuscript format), EPUB, PDF.
import fs from 'node:fs'
import path from 'node:path'
import { marked } from 'marked'
import { AlignmentType, Document, HeadingLevel, Packer, PageBreak, Paragraph, TextRun, Header, PageNumber } from 'docx'
import * as epubModule from 'epub-gen-memory'

// CJS interop differs between Vitest and Electron's ESM loader.
const epub = ((epubModule as { default?: unknown }).default as { default?: unknown })?.default ?? (epubModule as { default?: unknown }).default ?? epubModule
type EpubFn = (o: unknown, c: { title: string; content: string }[]) => Promise<Buffer>
import { compileManuscript, loadConfig, countWords } from '@shared/project'
import type { ExportFormat } from '@shared/types'

export interface ExportResult {
  file: string
  words: number
}

/** Render PDF HTML -> buffer; injected by main (uses a hidden BrowserWindow). */
export type PdfRenderer = (html: string) => Promise<Buffer>

export async function exportManuscript(root: string, format: ExportFormat, outFile: string | undefined, renderPdf: PdfRenderer): Promise<ExportResult> {
  const cfg = loadConfig(root)
  const ms = compileManuscript(root, { sceneBreak: '\n\n#\n\n' })
  const words = ms.chapters.reduce((a, c) => a + countWords(c.text), 0)
  const base = (cfg.title || 'manuscript').replace(/[<>:"/\\|?*]+/g, '').trim() || 'manuscript'
  const file = outFile ?? path.join(root, 'exports', `${base}.${format}`)
  fs.mkdirSync(path.dirname(file), { recursive: true })

  if (format === 'md') {
    const md = [`# ${cfg.title}`, cfg.author ? `*by ${cfg.author}*` : '', ...ms.chapters.map((c) => `## ${c.title}\n\n${c.text}`)].filter(Boolean).join('\n\n')
    fs.writeFileSync(file, md, 'utf8')
  } else if (format === 'docx') {
    fs.writeFileSync(file, await toDocx(cfg.title, cfg.author, words, ms.chapters))
  } else if (format === 'epub') {
    const buf = await (epub as EpubFn)(
      { title: cfg.title, author: cfg.author || 'Unknown', lang: 'en', css: EPUB_CSS, verbose: false } as never,
      ms.chapters.map((c) => ({ title: c.title, content: htmlBody(c.text) }))
    )
    fs.writeFileSync(file, buf)
  } else if (format === 'pdf') {
    fs.writeFileSync(file, await renderPdf(toHtml(cfg.title, cfg.author, ms.chapters)))
  }
  return { file, words }
}

function htmlBody(md: string): string {
  return (marked.parse(md.replace(/^\s*#\s*$/gm, '<p class="break">#</p>'), { async: false }) as string)
}

const EPUB_CSS = `p { text-indent: 1.5em; margin: 0; line-height: 1.5 } p.break { text-align: center; text-indent: 0; margin: 1em 0 } h1,h2 { text-align: center }`

export function toHtml(title: string, author: string, chapters: { title: string; text: string }[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: Letter; margin: 1in }
    body { font-family: 'Georgia', 'Times New Roman', serif; font-size: 12pt; line-height: 1.6; color: #111 }
    .title { text-align: center; margin-top: 3in; page-break-after: always }
    h2 { text-align: center; page-break-before: always; margin-top: 2in; font-weight: normal; font-size: 18pt }
    p { text-indent: 0.5in; margin: 0 }
    p.break { text-align: center; text-indent: 0; margin: 1em 0 }
  </style></head><body>
  <div class="title"><h1>${esc(title)}</h1>${author ? `<p style="text-indent:0">by ${esc(author)}</p>` : ''}</div>
  ${chapters.map((c) => `<h2>${esc(c.title)}</h2>${htmlBody(c.text)}`).join('\n')}
  </body></html>`
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

/** Inline **bold** / *italic* runs for DOCX. */
function runs(text: string): TextRun[] {
  const out: TextRun[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(new TextRun(text.slice(last, m.index)))
    const t = m[0]
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), bold: true }))
    else out.push(new TextRun({ text: t.slice(1, -1), italics: true }))
    last = m.index! + t.length
  }
  if (last < text.length) out.push(new TextRun(text.slice(last)))
  return out
}

/** Standard manuscript format (Shunn-style): 12pt, double spaced, 0.5" indents, # scene breaks. */
async function toDocx(title: string, author: string, words: number, chapters: { title: string; text: string }[]): Promise<Buffer> {
  const rounded = Math.round(words / 1000) * 1000 || words
  const body: Paragraph[] = [
    new Paragraph({ children: [new TextRun(author || 'Author Name')] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun(`about ${rounded.toLocaleString()} words`)] }),
    ...Array.from({ length: 10 }, () => new Paragraph('')),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: title.toUpperCase() })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(author ? `by ${author}` : '')] })
  ]
  for (const ch of chapters) {
    body.push(new Paragraph({ children: [new PageBreak()] }))
    body.push(...Array.from({ length: 6 }, () => new Paragraph('')))
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER, children: [new TextRun({ text: ch.title, color: '000000' })] }))
    body.push(new Paragraph(''))
    for (const para of ch.text.split(/\n\s*\n/)) {
      const t = para.replace(/\s*\n\s*/g, ' ').trim()
      if (!t) continue
      if (/^#+$/.test(t) || t === '***' || t === '* * *') {
        body.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('#')] }))
        continue
      }
      body.push(new Paragraph({ indent: { firstLine: 720 }, children: runs(t.replace(/^#+\s+/, '')) }))
    }
  }
  body.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('END')] }))
  const lastName = (author.split(/\s+/).pop() || 'Author').toUpperCase()
  const doc = new Document({
    creator: author || 'Novel Coder',
    title,
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 }, paragraph: { spacing: { line: 480 } } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun(`${lastName} / ${title.split(/\s+/).slice(0, 3).join(' ').toUpperCase()} / `), new TextRun({ children: [PageNumber.CURRENT] })]
              })
            ]
          })
        },
        children: body
      }
    ]
  })
  return Packer.toBuffer(doc)
}
