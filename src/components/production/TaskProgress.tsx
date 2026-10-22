import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, Loader2, AlertCircle } from 'lucide-react'

export type TaskPhase = 'preparing' | 'generating' | 'validating' | 'persisting' | 'saving'
export interface ProgressEvent { phase: TaskPhase; detail: string; receivedChars?: number }
export type ProgressReporter = (event: ProgressEvent) => void
export interface ProductionTask extends ProgressEvent {
  name: string
  kind: 'model' | 'local'
  startedAt: number
  finishedAt?: number
  status: 'running' | 'done' | 'failed'
}

const phases: TaskPhase[] = ['preparing', 'generating', 'validating', 'persisting', 'saving']
const modelLabels = ['准备任务', '模型生成', '校验结果', '写入项目', '保存到本机']
const localLabels = ['准备任务', '处理内容', '校验结果', '写入项目', '保存到本机']

export function TaskProgress({ task }: { task: ProductionTask }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (task.status !== 'running') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [task.startedAt, task.status])
  const index = phases.indexOf(task.phase)
  const done = task.status === 'done'
  const elapsed = Math.max(0, Math.floor(((task.finishedAt ?? now) - task.startedAt) / 1000))
  const labels = task.kind === 'model' ? modelLabels : localLabels
  return <section aria-label="任务进度" aria-busy={task.status === 'running'} className="mb-6 rounded-xl border border-border bg-background-soft p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 font-medium">
        {done ? <CheckCircle2 className="h-5 w-5 text-green-400"/> : task.status === 'failed' ? <AlertCircle className="h-5 w-5 text-red-400"/> : <Loader2 className="h-5 w-5 animate-spin text-accent"/>}
        {task.name} · {done ? '已完成' : task.status === 'failed' ? '失败' : '进行中'}
      </div>
      <span className="text-xs text-muted">{done ? 5 : index} / 5 阶段已完成 · 耗时 {elapsed} 秒</span>
    </div>
    <ol className="my-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
      {phases.map((phase, i) => <li key={phase} className={`flex items-center gap-2 text-xs ${done || i < index ? 'text-green-400' : i === index ? 'text-accent' : 'text-muted'}`}>
        {done || i < index ? <CheckCircle2 className="h-4 w-4"/> : i === index && task.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin"/> : <Circle className="h-4 w-4"/>}{labels[i]}
      </li>)}
    </ol>
    <div role="progressbar" aria-label={task.name+'阶段进度'} aria-valuemin={0} aria-valuemax={5} aria-valuenow={done ? 5 : index} aria-valuetext={task.detail} className="h-1.5 overflow-hidden rounded-full bg-background-soft-2">
      <div className={`h-full rounded-full transition-all duration-300 ${task.status === 'failed' ? 'bg-red-400' : done ? 'bg-green-400' : 'bg-accent'}`} style={{width:`${(done ? 5 : index)/5*100}%`}}/>
    </div>
    <p role="status" className="mt-3 text-sm text-muted">{task.detail}{task.receivedChars !== undefined && task.status === 'running' ? ` · 已接收 ${task.receivedChars.toLocaleString()} 字` : ''}</p>
    {task.status === 'running' && task.phase === 'generating' && <p className="mt-1 text-xs text-muted">{task.receivedChars ? '正在接收模型输出，完成后自动校验并保存。' : '等待模型响应，收到内容后会实时更新。'}阶段进度不代表模型输出百分比。</p>}
  </section>
}
