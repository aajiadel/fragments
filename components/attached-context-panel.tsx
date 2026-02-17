import { CodeSelectionMeta } from './code-view'
import { Button } from '@/components/ui/button'

export function AttachedContextPanel({
  code,
  meta,
  onClear,
}: {
  code: string
  meta?: CodeSelectionMeta | null
  onClear: () => void
}) {
  return (
    <div className="mx-4 mb-2 rounded-2xl border bg-muted/30 shadow-sm">
      <div className="flex items-center justify-between px-4 py-2 gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Attached context</span>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-md border px-2 py-0.5 bg-background/70">
              {code.length} chars
            </span>
            {meta?.startLine !== undefined && meta?.endLine !== undefined && (
              <span>
                Lines {meta.startLine} - {meta.endLine}
              </span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </div>
      <pre className="px-4 pb-4 max-h-48 overflow-auto text-xs whitespace-pre-wrap">
        <code>{code}</code>
      </pre>
    </div>
  )
}
