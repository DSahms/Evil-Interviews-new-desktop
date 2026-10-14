'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { FileDown, FileText, BookOpen, Mic, Loader2, MicOff, Square } from 'lucide-react'
import { toast } from 'sonner'

interface ExportMenuProps {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfigureTts?: () => void
}

type Format = 'magazine-qa' | 'first-person-narrative' | 'manuscript-md' | 'manuscript-pdf' | 'manuscript-docx' | 'audio-qa' | 'combined'

type NarrativeStep = 'idle' | 'retrieving-context' | 'generating-narrative' | 'saving' | 'done' | 'stopped' | 'error'

interface NarrativeJob {
  id: string
  currentStep: NarrativeStep
  progress: number
  message: string
  error: string | null
}

export function ExportMenu({ projectId, open: _open, onOpenChange: _onOpenChange, onConfigureTts }: ExportMenuProps) {
  const [busy, setBusy] = useState<Format | null>(null)
  const [ttsConfigured, setTtsConfigured] = useState<boolean | null>(null)
  const [narrativeJob, setNarrativeJob] = useState<NarrativeJob | null>(null)
  const [narrativeStopping, setNarrativeStopping] = useState(false)

  useEffect(() => {
    fetch('/api/tts-providers')
      .then((r) => r.json())
      .then((data) => {
        const has = (data.providers || []).some((p: { isActive: boolean }) => p.isActive)
        setTtsConfigured(has)
      })
      .catch(() => setTtsConfigured(false))
  }, [busy])

  // Check if a narrative job is already running for this project (e.g.,
  // after page refresh) — if so, resume polling.
  useEffect(() => {
    fetch(`/api/projects/${projectId}/narrative`)
      .then((r) => r.json())
      .then((data) => {
        if (data.active && data.job) {
          setNarrativeJob({
            id: data.job.id,
            currentStep: data.job.currentStep,
            progress: data.job.progress,
            message: data.job.message,
            error: data.job.error,
          })
        }
      })
      .catch(() => { /* silent */ })
  }, [projectId])

  // Poll narrative job status while running.
  useEffect(() => {
    if (!narrativeJob) return
    if (narrativeJob.currentStep === 'done' || narrativeJob.currentStep === 'stopped' || narrativeJob.currentStep === 'error') {
      return
    }
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/narrative/${narrativeJob.id}`)
        if (!res.ok) {
          clearInterval(interval)
          return
        }
        const data = await res.json()
        setNarrativeJob({
          id: data.id,
          currentStep: data.currentStep,
          progress: data.progress,
          message: data.message,
          error: data.error,
        })

        if (data.currentStep === 'done') {
          // Fetch the result content
          const resultRes = await fetch(`/api/projects/${projectId}/narrative/${narrativeJob.id}/result`)
          const resultData = await resultRes.json()
          if (resultRes.ok && resultData.content) {
            const blob = new Blob([resultData.content], { type: 'text/markdown' })
            triggerDownload(blob, filenameFor('first-person-narrative', projectId))
            toast.success('Narrative export ready', { description: `${resultData.content.length} chars — downloaded.` })
          } else {
            toast.error('Narrative result fetch failed', { description: resultData.error || '' })
          }
        } else if (data.currentStep === 'stopped') {
          toast.success('Narrative export stopped.')
        } else if (data.currentStep === 'error') {
          toast.error('Narrative export failed', { description: data.error || '' })
        }
      } catch {
        // silent
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [narrativeJob, projectId])

  const handleExport = async (format: Format) => {
    if (format === 'audio-qa' && ttsConfigured === false) {
      toast.error('Audio is unavailable', { description: 'No TTS provider is configured. Open Provider settings to add one.' })
      onConfigureTts?.()
      return
    }

    // First-person narrative is now INSTANT — narratives are pre-written
    // during chapter advancement. No background job needed.
    // Combined export is also instant — just concatenates Q&A + narrative.

    setBusy(format)
    try {
      const res = await fetch(`/api/projects/${projectId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      })
      if (res.status === 503) {
        const data = await res.json().catch(() => null)
        if (data?.ttsUnconfigured) {
          toast.error('Audio is unavailable', { description: data.error || 'No TTS provider is configured.' })
          onConfigureTts?.()
        } else {
          toast.error('Audio export failed', { description: data?.error || 'Service unavailable.' })
        }
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Export failed')
      }
      if (format === 'magazine-qa' || format === 'manuscript-md' || format === 'first-person-narrative' || format === 'combined') {
        const data = await res.json()
        const blob = new Blob([data.content || ''], { type: 'text/markdown' })
        triggerDownload(blob, filenameFor(format, projectId))
        toast.success('Export ready', { description: `${filenameFor(format, projectId)} — ${(data.content || '').length} chars` })
      } else {
        const blob = await res.blob()
        triggerDownload(blob, filenameFor(format, projectId))
        toast.success('Export ready', { description: filenameFor(format, projectId) })
      }
    } catch (e) {
      toast.error('Export failed', { description: e instanceof Error ? e.message : '' })
    } finally { setBusy(null) }
  }

  const handleStopNarrative = async () => {
    if (!narrativeJob) return
    setNarrativeStopping(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/narrative/${narrativeJob.id}/stop`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to stop')
      toast.success('Stop requested', { description: 'Will stop at the next checkpoint.' })
    } catch (e) {
      toast.error('Failed to stop', { description: e instanceof Error ? e.message : '' })
    } finally {
      setNarrativeStopping(false)
    }
  }

  // Narrative job progress UI (replaces the dropdown when running)
  if (narrativeJob) {
    const isRunning = narrativeJob.currentStep !== 'done' && narrativeJob.currentStep !== 'stopped' && narrativeJob.currentStep !== 'error'
    return (
      <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 text-xs">
            {isRunning && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
            <span className="font-medium text-foreground">Narrative {narrativeJob.progress}%</span>
          </div>
          <div className="w-full h-1 bg-muted rounded-full overflow-hidden mt-1" style={{ width: '120px' }}>
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.max(2, narrativeJob.progress)}%` }}
            />
          </div>
        </div>
        {isRunning ? (
          <Button variant="ghost" size="sm" onClick={handleStopNarrative} disabled={narrativeStopping} className="h-7 px-2 text-xs">
            {narrativeStopping ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Square className="w-3 h-3 mr-1" />}
            Stop
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setNarrativeJob(null)} className="h-7 px-2 text-xs">
            Dismiss
          </Button>
        )}
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileDown className="w-4 h-4 mr-1.5" />}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">Three outputs</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => handleExport('magazine-qa')} disabled={busy !== null}>
          <FileText className="w-4 h-4 mr-2" />
          <div className="flex flex-col"><span>Magazine-style Q&amp;A</span><span className="text-xs text-muted-foreground">Markdown — interviewer asks, character answers</span></div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('first-person-narrative')} disabled={busy !== null}>
          <BookOpen className="w-4 h-4 mr-2" />
          <div className="flex flex-col"><span>First-person narrative</span><span className="text-xs text-muted-foreground">Markdown — pre-compiled per chapter, instant</span></div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('combined')} disabled={busy !== null}>
          <FileText className="w-4 h-4 mr-2" />
          <div className="flex flex-col"><span>Combined (Q&A + Narrative)</span><span className="text-xs text-muted-foreground">One markdown file with YAML front matter for reader app</span></div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('audio-qa')} disabled={busy !== null} className={ttsConfigured === false ? 'opacity-60' : ''}>
          {ttsConfigured === false ? <MicOff className="w-4 h-4 mr-2 text-muted-foreground" /> : <Mic className="w-4 h-4 mr-2" />}
          <div className="flex flex-col">
            <span>Audio Q&amp;A {ttsConfigured === false && <span className="text-xs text-muted-foreground">(configure TTS)</span>}</span>
            <span className="text-xs text-muted-foreground">{ttsConfigured === false ? 'No TTS provider configured — click to open settings' : 'MP3 — listen to the interview'}</span>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">Manuscript</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => handleExport('manuscript-md')} disabled={busy !== null}><FileText className="w-4 h-4 mr-2" /><span>Manuscript — Markdown</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('manuscript-pdf')} disabled={busy !== null}><FileDown className="w-4 h-4 mr-2" /><span>Manuscript — PDF (literary)</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('manuscript-docx')} disabled={busy !== null}><FileDown className="w-4 h-4 mr-2" /><span>Manuscript — DOCX</span></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function filenameFor(format: Format, projectId: string): string {
  switch (format) {
    case 'magazine-qa': return `magazine-qa-${projectId}.md`
    case 'first-person-narrative': return `first-person-narrative-${projectId}.md`
    case 'manuscript-md': return `manuscript-${projectId}.md`
    case 'manuscript-pdf': return `manuscript-${projectId}.pdf`
    case 'manuscript-docx': return `manuscript-${projectId}.docx`
    case 'audio-qa': return `qa-${projectId}.mp3`
    case 'combined': return `combined-${projectId}.md`
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
