import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import Placeholder from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import { Bold, Italic, Heading2, Quote, Minus, List, Undo2, Redo2 } from 'lucide-react'

/** Just the words and numbers, so formatting differences don't count but missing text does. */
const textOf = (md: string) => md.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase()

/** True when the editor would drop text from this Markdown (something it can't show), so saving from it would lose writing. */
export function editorLosesText(original: string, fromEditor: string): boolean {
  return textOf(original) !== textOf(fromEditor)
}

/**
 * The editor's Markdown. Table cells come out with "&" written as "&amp;"; turn that back into a plain "&"
 * (unless it would then read as an entity like "&copy;") so saving a timeline doesn't litter it with "&amp;".
 */
export function editorMarkdown(editor: Editor): string {
  return editor.getMarkdown().replace(/&amp;(?![a-zA-Z][a-zA-Z0-9]*;|#\d+;|#x[0-9a-fA-F]+;)/g, '&')
}

export interface ProseEditorHandle {
  editor: Editor | null
}

/** WYSIWYG prose editor that reads/writes Markdown. `version` bumps force-reload `value`. */
export function ProseEditor({
  value,
  version,
  onChange,
  placeholder = 'Start writing…',
  onSelectionChange,
  editorRef,
  onEditor,
  onLossy,
  className = ''
}: {
  /** Called after each load with whether the editor dropped any of the file's text. */
  onLossy?: (lossy: boolean) => void
  onEditor?: (e: Editor | null) => void
  value: string
  version: number
  onChange: (md: string) => void
  placeholder?: string
  onSelectionChange?: (text: string) => void
  editorRef?: React.MutableRefObject<Editor | null>
  className?: string
}) {
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const selRef = useRef(onSelectionChange)
  selRef.current = onSelectionChange
  const loading = useRef(false)

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), TableKit.configure({ table: { resizable: false } }), Markdown, Placeholder.configure({ placeholder })],
    content: value,
    contentType: 'markdown',
    onUpdate: ({ editor }) => {
      if (!loading.current) changeRef.current(editorMarkdown(editor))
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection
      selRef.current?.(from === to ? '' : editor.state.doc.textBetween(from, to, '\n\n'))
    }
  })

  useEffect(() => {
    if (editorRef) editorRef.current = editor
    onEditor?.(editor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, editorRef])

  useEffect(() => {
    if (!editor) return
    loading.current = true
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
    loading.current = false
    onLossy?.(editorLosesText(value, editorMarkdown(editor)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, editor])

  return (
    <div className={`prose-editor ${className}`}>
      <EditorContent editor={editor} spellCheck />
    </div>
  )
}

export function FormatBar({ editor }: { editor: Editor | null }) {
  const [, force] = useState(0)
  useEffect(() => {
    if (!editor) return
    const h = () => force((n) => n + 1)
    editor.on("transaction", h)
    return () => {
      editor.off("transaction", h)
    }
  }, [editor])
  if (!editor) return null
  const b = (title: string, on: boolean, fn: () => void, icon: React.ReactNode) => (
    <button title={title} className={`icon-btn h-7 w-7 ${on ? 'bg-panel2 text-accent' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={fn}>
      {icon}
    </button>
  )
  const c = () => editor.chain().focus()
  return (
    <div className="flex items-center gap-0.5">
      {b('Bold (Ctrl+B)', editor.isActive('bold'), () => c().toggleBold().run(), <Bold size={14} />)}
      {b('Italic (Ctrl+I)', editor.isActive('italic'), () => c().toggleItalic().run(), <Italic size={14} />)}
      {b('Heading', editor.isActive('heading'), () => c().toggleHeading({ level: 2 }).run(), <Heading2 size={14} />)}
      {b('Quote', editor.isActive('blockquote'), () => c().toggleBlockquote().run(), <Quote size={14} />)}
      {b('List', editor.isActive('bulletList'), () => c().toggleBulletList().run(), <List size={14} />)}
      {b('Scene break', false, () => c().setHorizontalRule().run(), <Minus size={14} />)}
      <span className="mx-1.5 h-4 w-px bg-line-strong" />
      {b('Undo (Ctrl+Z)', false, () => c().undo().run(), <Undo2 size={14} />)}
      {b('Redo (Ctrl+Y)', false, () => c().redo().run(), <Redo2 size={14} />)}
    </div>
  )
}

export function countWordsClient(text: string): number {
  const m = text
    .replace(/^---[\s\S]*?\n---/, ' ')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, ' ')
    .replace(/^\s*-{3,}\s*$/gm, ' ')
    .replace(/[#>*_`~|]+/g, ' ')
    .match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)
  return m ? m.length : 0
}
