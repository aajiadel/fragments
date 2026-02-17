import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export function SelectionContextMenu({
  text,
  position,
  onAttach,
  onClear,
}: {
  text: string
  position: { left: number; top: number }
  onAttach: () => void
  onClear: () => void
}) {
  return (
    <Card
      className="fixed z-50 shadow-xl border bg-background"
      style={{ left: position.left, top: position.top }}
    >
      <div className="flex flex-col min-w-[220px] text-sm">
        <div className="px-3 pt-2 pb-1 text-xs text-muted-foreground truncate">
          {text.slice(0, 120)}{text.length > 120 ? '…' : ''}
        </div>
        <Button
          variant="ghost"
          className="justify-start rounded-none border-t"
          onClick={onAttach}
        >
          Attach to prompt
        </Button>
        <Button
          variant="ghost"
          className="justify-start rounded-none border-t"
          onClick={onClear}
        >
          Clear selection
        </Button>
      </div>
    </Card>
  )
}
