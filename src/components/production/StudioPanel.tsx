import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * 生产台的一级区块：故事与方案、分镜与镜头、成片、逐步节点都用这一种外观，
 * 标题行可折叠，右侧是灰色摘要（镜头数、时长、状态）。
 */
export function StudioPanel({
  id,
  title,
  meta,
  description,
  open,
  children,
}: {
  id?: string
  title: string
  meta?: ReactNode
  description?: ReactNode
  open?: boolean
  children: ReactNode
}) {
  return (
    <details
      id={id}
      open={open}
      className="group mb-6 rounded-2xl border border-border bg-background-soft"
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 select-none md:px-6 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-90" />
        <h2 className="text-base font-semibold">{title}</h2>
        {meta && <span className="ml-auto text-right text-xs text-muted">{meta}</span>}
      </summary>
      <div className="space-y-4 border-t border-border px-5 py-5 md:px-6">
        {description && <p className="text-sm text-muted">{description}</p>}
        {children}
      </div>
    </details>
  )
}

/** 一级区块里的内容卡（原文、角色、方案、每个镜头）。 */
export function PanelCard({
  title,
  action,
  className,
  children,
}: {
  title?: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('rounded-xl border border-border bg-background p-4', className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center gap-3">
          {title && <h3 className="text-sm font-medium">{title}</h3>}
          {action && <div className="ml-auto">{action}</div>}
        </div>
      )}
      {children}
    </section>
  )
}
