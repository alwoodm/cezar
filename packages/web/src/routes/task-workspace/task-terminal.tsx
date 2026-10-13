import { lazy, Suspense, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { useHealth, useRun } from '@/api/queries'

import { GitTabLoadError, GitTabLoading } from '../task-git/git-tab-loading'
import { RunHeader } from '../task-thread/run-header'
import { readDrawerState, writeDrawerState } from './drawer-state'

const TerminalDrawer = lazy(() =>
  import('./terminal-drawer').then((m) => ({ default: m.TerminalDrawer })),
)

/**
 * `/tasks/:id/terminal` — the task terminal (spec `2026-10-07-task-workspace` §6) as a tab of the
 * current task view. Sessions are server-owned, so leaving the tab keeps every shell running.
 */
export function TaskTerminalRoute() {
  const { id } = useParams<{ id: string }>()
  const run = useRun(id)
  const navigate = useNavigate()
  const allowed = useHealth().data?.capabilities?.terminal === true
  const [height, setHeight] = useState(() => (id ? readDrawerState(id).height : 0))

  if (run.isPending) return <GitTabLoading tab="terminal" />
  if (run.isError) return <GitTabLoadError tab="terminal" error={run.error} />
  const runId = run.data.id
  return (
    <div data-route="task-terminal" className="flex min-h-full flex-col">
      <RunHeader run={run.data} tab="terminal" />
      {allowed ? (
        <Suspense fallback={null}>
          <TerminalDrawer
            runId={runId}
            height={height}
            onHeightChange={(next) => {
              setHeight(next)
              writeDrawerState(runId, { open: true, height: next })
            }}
            onClose={() => navigate(`/tasks/${runId}`)}
            onOpenInBrowser={(url) => window.open(url, '_blank', 'noopener,noreferrer') !== null}
          />
        </Suspense>
      ) : (
        <p className="px-6 py-5 text-sm text-soft-foreground">
          The terminal is disabled on this cockpit — it is off in hosted mode unless CEZ_TERMINAL=1.
        </p>
      )}
    </div>
  )
}
