'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Loader2, Play, Pause, Square, FastForward } from 'lucide-react'
import { toast } from 'sonner'

interface AutoRunPanelProps {
  projectId: string
  onTurnCompleted: () => void
}

type Step = 'idle' | 'generating-question' | 'generating-answer' | 'extracting-canon' | 'composing-manuscript' | 'advancing-chapter' | 'done' | 'stopped' | 'error'

interface Job {
  id: string
  targetCount: number
  completedTurns: number
  currentStep: Step
  currentTurnId: string | null
  currentTurnQuestion: string | null
  error: string | null
  startedAt: number
  finishedAt: number | null
  autoAdvanceEvery: number
  fullInterview: boolean
  turnsPerChapter: number
  currentChapter: number
  targetChapter: number
}

export function AutoRunPanel({ projectId, onTurnCompleted }: AutoRunPanelProps) {
  // Form state
  const [count, setCount] = useState(5)
  const [autoAdvance, setAutoAdvance] = useState(false)
  const [autoAdvanceEvery, setAutoAdvanceEvery] = useState(3)
  const [fullInterview, setFullInterview] = useState(false)
  const [turnsPerChapter, setTurnsPerChapter] = useState(3)
  const [job, setJob] = useState<Job | null>(null)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [lastCompletedTurns, setLastCompletedTurns] = useState(0)

  const checkActive = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/auto-run`)
      const data = await res.json()
      if (data.active && data.job) {
        setJob(data.job)
      }
    } catch {
      // silent
    }
  }, [projectId])

  useEffect(() => {
    void checkActive()
  }, [checkActive])

  useEffect(() => {
    if (!job) return
    if (job.currentStep === 'done' || job.currentStep === 'stopped' || job.currentStep === 'error') {
      return
    }
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/auto-run/${job.id}`)
        if (!res.ok) {
          clearInterval(interval)
          return
        }
        const data = await res.json()
        setJob(data)
        if (data.completedTurns > lastCompletedTurns) {
          setLastCompletedTurns(data.completedTurns)
          onTurnCompleted()
        }
        if (data.currentStep === 'done' || data.currentStep === 'stopped' || data.currentStep === 'error') {
          onTurnCompleted()
          if (data.currentStep === 'done') {
            toast.success(`Auto-run complete — ${data.completedTurns}/${data.targetCount} turns.`)
          } else if (data.currentStep === 'stopped') {
            toast.success(`Auto-run stopped — ${data.completedTurns} turns completed.`)
          } else if (data.currentStep === 'error') {
            toast.error('Auto-run failed', { description: data.error || '' })
          }
        }
      } catch {
        // silent
      }
    }, 2500)
    return () => clearInterval(interval)
  }, [job, lastCompletedTurns, onTurnCompleted, projectId])

  const handleStart = async (mode: 'fresh' | 'resume' = 'fresh') => {
    setStarting(true)
    try {
      const body: Record<string, unknown> = {
        count,
        autoAdvanceEvery: autoAdvance ? autoAdvanceEvery : 0,
      }
      if (fullInterview) {
        body.fullInterview = true
        body.turnsPerChapter = turnsPerChapter
      }
      const res = await fetch(`/api/projects/${projectId}/auto-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to start auto-run')
      }
      setJob({
        id: data.jobId,
        targetCount: data.targetCount,
        completedTurns: 0,
        currentStep: 'idle',
        currentTurnId: null,
        currentTurnQuestion: null,
        error: null,
        startedAt: data.startedAt,
        finishedAt: null,
        autoAdvanceEvery: data.autoAdvanceEvery,
        fullInterview: data.fullInterview,
        turnsPerChapter: data.turnsPerChapter,
        currentChapter: data.currentChapter,
        targetChapter: data.targetChapter,
      })
      setLastCompletedTurns(0)
      const desc = data.fullInterview
        ? `Full interview — ${data.turnsPerChapter} turns × ${data.targetChapter} chapters.`
        : `${data.targetCount} turns.`
      toast.success(`Auto-run started`, { description: desc })
    } catch (e) {
      toast.error('Failed to start auto-run', { description: e instanceof Error ? e.message : '' })
    } finally {
      setStarting(false)
    }
    void mode
  }

  const handlePause = async () => {
    if (!job) return
    setStopping(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/auto-run/${job.id}/stop`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to pause')
      toast.success('Pause requested', { description: 'Will finish the current step and pause.' })
    } catch (e) {
      toast.error('Failed to pause', { description: e instanceof Error ? e.message : '' })
    } finally {
      setStopping(false)
    }
  }

  // "End" is the same as pause functionally — both set stopRequested. The
  // semantic difference is in the user's intent: pause = will resume later,
  // end = done for now. Either way, state is preserved in the database.
  const handleEnd = handlePause

  const isRunning = job && job.currentStep !== 'done' && job.currentStep !== 'stopped' && job.currentStep !== 'error'

  // Running state — show progress + Pause + End buttons
  if (job) {
    const progress = job.completedTurns / job.targetCount
    const stepLabel = stepToLabel(job.currentStep)
    const chapterInfo = job.fullInterview
      ? `Chapter ${job.currentChapter}/${job.targetChapter}`
      : ''
    return (
      <Card className="p-4 border-primary/40 bg-primary/5">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Auto-run</h3>
          <span className="text-xs text-muted-foreground font-mono">
            {chapterInfo && <span className="mr-2">{chapterInfo}</span>}
            {job.completedTurns}/{job.targetCount}
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mb-3">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.max(2, Math.round(progress * 100))}%` }}
          />
        </div>

        {/* Current step */}
        <div className="flex items-center gap-2 text-sm mb-2">
          {isRunning && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
          <span className="text-foreground">{stepLabel}</span>
        </div>

        {/* Current turn preview */}
        {job.currentTurnQuestion && isRunning && (
          <div className="text-xs text-muted-foreground italic line-clamp-2 mb-2 border-l-2 border-primary/30 pl-2">
            {job.currentTurnQuestion}
          </div>
        )}

        {/* Terminal state */}
        {!isRunning && (
          <div className={`text-xs mb-2 ${job.currentStep === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {job.currentStep === 'done' && `Complete. ${job.completedTurns} turn${job.completedTurns !== 1 ? 's' : ''} generated.`}
            {job.currentStep === 'stopped' && `Paused. ${job.completedTurns} turn${job.completedTurns !== 1 ? 's' : ''} completed. Click Resume to continue, or Dismiss to start fresh.`}
            {job.currentStep === 'error' && (job.error || 'Failed.')}
          </div>
        )}

        {/* Action buttons while running */}
        {isRunning && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handlePause} disabled={stopping} className="flex-1">
              {stopping ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Pause className="w-3.5 h-3.5 mr-1.5" />}
              Pause
            </Button>
            <Button variant="ghost" size="sm" onClick={handleEnd} disabled={stopping} className="text-destructive hover:text-destructive">
              <Square className="w-3.5 h-3.5 mr-1.5" />
              End
            </Button>
          </div>
        )}

        {/* Paused/stopped state — show Resume + Dismiss */}
        {job.currentStep === 'stopped' && (
          <div className="flex gap-2">
            <Button variant="default" size="sm" onClick={() => handleStart('resume')} disabled={starting} className="flex-1">
              {starting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
              Resume
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setJob(null)} className="text-destructive hover:text-destructive">
              <Square className="w-3.5 h-3.5 mr-1.5" />
              Dismiss
            </Button>
          </div>
        )}

        {/* Done/error state — Dismiss only */}
        {(job.currentStep === 'done' || job.currentStep === 'error') && (
          <Button variant="ghost" size="sm" onClick={() => setJob(null)} className="w-full">
            Dismiss
          </Button>
        )}
      </Card>
    )
  }

  // Idle state — show the start form
  return (
    <Card className="p-4">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Auto-run</h3>
      <div className="space-y-3">
        {/* Mode toggle */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Checkbox id="full-interview" checked={fullInterview} onCheckedChange={(v) => setFullInterview(Boolean(v))} />
            <Label htmlFor="full-interview" className="text-xs text-muted-foreground cursor-pointer">
              Run through ALL 11 chapters
            </Label>
          </div>
          {fullInterview && (
            <div className="flex items-center gap-2 pl-6">
              <Label htmlFor="tpc" className="text-xs text-muted-foreground">Turns per chapter:</Label>
              <Input
                id="tpc"
                type="number"
                min={1}
                max={20}
                value={turnsPerChapter}
                onChange={(e) => setTurnsPerChapter(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                className="h-7 w-16 text-xs"
              />
              <span className="text-xs text-muted-foreground">= {turnsPerChapter * 11} total turns</span>
            </div>
          )}
        </div>

        {/* Count (only when not full-interview mode) */}
        {!fullInterview && (
          <div className="space-y-1.5">
            <Label htmlFor="auto-count" className="text-xs text-muted-foreground">Turns to generate</Label>
            <Input
              id="auto-count"
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              className="h-8"
            />
          </div>
        )}

        {/* Auto-advance (only when not full-interview mode — full mode auto-advances by definition) */}
        {!fullInterview && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Checkbox id="auto-advance" checked={autoAdvance} onCheckedChange={(v) => setAutoAdvance(Boolean(v))} />
              <Label htmlFor="auto-advance" className="text-xs text-muted-foreground cursor-pointer">
                Auto-advance chapter every
              </Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={autoAdvanceEvery}
                onChange={(e) => setAutoAdvanceEvery(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                disabled={!autoAdvance}
                className="h-7 w-16 text-xs"
              />
              <span className="text-xs text-muted-foreground">turns</span>
            </div>
          </div>
        )}

        <Button onClick={() => handleStart('fresh')} disabled={starting} className="w-full">
          {starting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : fullInterview ? <FastForward className="w-3.5 h-3.5 mr-1.5" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
          {fullInterview ? 'Start full interview' : 'Start auto-run'}
        </Button>

        <p className="text-xs text-muted-foreground leading-relaxed">
          {fullInterview
            ? `Generates ${turnsPerChapter} turns per chapter, advances, and continues through all 11 chapters. Each turn takes ~30–60s. Total: ~${Math.round(turnsPerChapter * 11 * 0.75)} min.`
            : 'Generates questions and answers automatically — the manuscript grows chapter by chapter without clicking. Each turn takes ~30–60s (4 LLM calls: question → answer → canon extract → manuscript compose).'}
        </p>

        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong>Pause</strong> stops after the current step (state is preserved). <strong>Resume</strong> continues from where you paused. <strong>End</strong> stops and dismisses — the project state remains.
        </p>
      </div>
    </Card>
  )
}

function stepToLabel(step: Step): string {
  switch (step) {
    case 'idle': return 'Starting…'
    case 'generating-question': return 'Generating question…'
    case 'generating-answer': return 'Generating answer…'
    case 'extracting-canon': return 'Extracting canon…'
    case 'composing-manuscript': return 'Composing manuscript…'
    case 'advancing-chapter': return 'Advancing to next chapter…'
    case 'done': return 'Complete'
    case 'stopped': return 'Paused'
    case 'error': return 'Failed'
  }
}
