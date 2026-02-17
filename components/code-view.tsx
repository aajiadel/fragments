// import "prismjs/plugins/line-numbers/prism-line-numbers.js";
// import "prismjs/plugins/line-numbers/prism-line-numbers.css";
import './code-theme.css'
import Prism from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-typescript'
import { useCallback, useEffect, useMemo, useRef, type MouseEvent } from 'react'

export type CodeSelectionMeta = {
  startLine?: number
  endLine?: number
  startCol?: number
  endCol?: number
}

export type CodeSelection = {
  code: string
  meta?: CodeSelectionMeta | null
  rect?: { left: number; top: number; bottom: number }
}

export function CodeView({
  code,
  lang,
  onSelectionChange,
  clearSelectionSignal,
  interactionMode = 'auto',
}: {
  code: string
  lang: string
  onSelectionChange?: (selection: CodeSelection | null) => void
  clearSelectionSignal?: number
  interactionMode?: 'auto' | 'menu'
}) {
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    Prism.highlightAll()
  }, [code])

  const computeMeta = useCallback(
    (range: Range): { meta: CodeSelectionMeta; rect?: CodeSelection['rect'] } => {
      const pre = preRef.current
      if (!pre) return { meta: {} }

      const beforeRange = range.cloneRange()
      beforeRange.selectNodeContents(pre)
      beforeRange.setEnd(range.startContainer, range.startOffset)

      const startOffset = beforeRange.toString().length
      const selectedLength = range.toString().length
      const textContent = pre.innerText || pre.textContent || ''

      const before = textContent.slice(0, startOffset)
      const selectionSlice = textContent.slice(
        startOffset,
        startOffset + selectedLength,
      )

      const startLine = before.split('\n').length
      const endLine = (before + selectionSlice).split('\n').length
      const startCol = before.length - before.lastIndexOf('\n')
      const endCol = (before + selectionSlice).length -
        (before + selectionSlice).lastIndexOf('\n')

      const rect = range.getBoundingClientRect()

      return {
        meta: {
          startLine,
          endLine,
          startCol,
          endCol,
        },
        rect: {
          left: rect.left,
          top: rect.top,
          bottom: rect.bottom,
        },
      }
    },
    [],
  )

  const handleSelectionCapture = useCallback(() => {
    if (!onSelectionChange || typeof window === 'undefined') return
    const selection = window.getSelection()
    const pre = preRef.current
    if (!selection || !pre) return

    if (
      !selection.anchorNode ||
      !selection.focusNode ||
      !pre.contains(selection.anchorNode) ||
      !pre.contains(selection.focusNode)
    ) {
      return
    }

    if (selection.rangeCount === 0 || selection.isCollapsed) return

    const range = selection.getRangeAt(0)
    const rawText = selection.toString()
    const trimmed = rawText.trim()
    if (!trimmed) return

    const { meta, rect } = computeMeta(range)
    onSelectionChange({ code: trimmed, meta, rect })
  }, [computeMeta, onSelectionChange])

  const handleContextMenu = useCallback(
    (e: MouseEvent<HTMLPreElement>) => {
      if (interactionMode !== 'menu') return
      if (!onSelectionChange || typeof window === 'undefined') return
      const selection = window.getSelection()
      const pre = preRef.current
      if (!selection || !pre) return

      if (
        !selection.anchorNode ||
        !selection.focusNode ||
        !pre.contains(selection.anchorNode) ||
        !pre.contains(selection.focusNode)
      ) {
        return
      }

      if (selection.rangeCount === 0 || selection.isCollapsed) return
      e.preventDefault()

      const range = selection.getRangeAt(0)
      const rawText = selection.toString()
      const trimmed = rawText.trim()
      if (!trimmed) return

      const { meta } = computeMeta(range)
      onSelectionChange({
        code: trimmed,
        meta,
        rect: { left: e.clientX, top: e.clientY, bottom: e.clientY },
      })
    },
    [computeMeta, interactionMode, onSelectionChange],
  )

  useEffect(() => {
    if (!clearSelectionSignal) return
    const selection = window.getSelection()
    selection?.removeAllRanges()
  }, [clearSelectionSignal])

  const preProps = useMemo(() => {
    return {
      onMouseUp: interactionMode === 'auto' ? handleSelectionCapture : undefined,
      onKeyUp: interactionMode === 'auto' ? handleSelectionCapture : undefined,
      onTouchEnd: interactionMode === 'auto' ? handleSelectionCapture : undefined,
      onContextMenu: handleContextMenu,
    }
  }, [handleContextMenu, handleSelectionCapture, interactionMode])

  return (
    <pre
      ref={preRef}
      className="p-4 pt-2"
      style={{
        fontSize: 12,
        backgroundColor: 'transparent',
        borderRadius: 0,
        margin: 0,
      }}
      {...preProps}
    >
      <code className={`language-${lang}`}>{code}</code>
    </pre>
  )
}
