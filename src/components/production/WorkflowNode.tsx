import type { ReactNode } from 'react'
import { CheckCircle2, Circle, Loader2, AlertCircle } from 'lucide-react'

export type NodeState = 'pending' | 'running' | 'done' | 'failed' | 'partial' | 'interrupted' | 'paused'
const labels: Record<NodeState, string> = { pending: '未执行', running: '进行中', done: '已完成', failed: '失败 · 可重试', partial: '部分完成', interrupted: '中断 · 可重试', paused:'已暂停' }
const colors: Record<NodeState, string> = {
  pending: 'border-border bg-background-soft text-muted',
  running: 'border-accent bg-accent/10 text-accent ring-1 ring-accent/40',
  done: 'border-green-500/60 bg-green-500/10 text-green-300',
  failed: 'border-red-500/60 bg-red-500/10 text-red-300',
  partial: 'border-amber-500/60 bg-amber-500/10 text-amber-300',
  interrupted: 'border-amber-500/60 bg-amber-500/10 text-amber-300',
  paused: 'border-amber-500/60 bg-amber-500/10 text-amber-300',
}
export function WorkflowNode({state,number,title,disabled,onClick,children,detail}: { state: NodeState; number: number; title: string; disabled?: boolean; onClick?:()=>void; children?:ReactNode; detail?:string }) {
  const className = `flex min-h-24 flex-col gap-3 rounded-xl border p-4 text-left transition-colors ${colors[state]} ${disabled ? 'cursor-default' : 'cursor-pointer hover:brightness-125'} focus-within:ring-2 focus-within:ring-accent`
  const content = <><span className="flex items-center justify-between gap-2 text-xs"><span className="font-mono">{String(number).padStart(2,'0')}</span><span className="flex items-center gap-1.5">{state==='done'?<CheckCircle2 className="h-4 w-4"/>:state==='running'?<Loader2 className="h-4 w-4 animate-spin"/>:state==='pending'?<Circle className="h-4 w-4"/>:<AlertCircle className="h-4 w-4"/>}{labels[state]}</span></span><span className="text-sm font-semibold">{title}</span>{detail&&<span className="text-xs opacity-80">{detail}</span>}{children}</>
  return children ? <label className={className} aria-label={title+' · '+labels[state]}>{content}</label> : <button type="button" className={className} disabled={disabled} onClick={onClick} aria-label={title+' · '+labels[state]}>{content}</button>
}
