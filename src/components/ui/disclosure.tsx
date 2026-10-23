import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

/** 区块内部的三级折叠项（高级设置、编辑本镜、剪辑调整等），全站一种样式；提醒类用 warning。 */
export function Disclosure({
  summary,
  tone = 'default',
  open,
  className,
  children,
}: {
  summary: ReactNode
  tone?: 'default' | 'warning'
  open?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <details open={open} className={cn('group/disclosure', className)}>
      <summary
        className={cn(
          'inline-flex cursor-pointer list-none items-center gap-1.5 text-sm select-none [&::-webkit-details-marker]:hidden',
          tone === 'warning' ? 'text-amber-200 hover:text-amber-100' : 'text-muted hover:text-foreground',
        )}
      >
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open/disclosure:rotate-90" />
        {summary}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  )
}
