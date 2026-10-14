'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, Loader2, ArrowRight, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from './ConfirmDialog'
import type { Chapter, Turn } from './WorkspaceView'

interface ChapterNavProps {
  chapters: Chapter[]
  currentChapter: number
  turns: Turn[]
  onAdvanceChapter: () => void
  advancingChapter: boolean
  canAdvance: boolean
  projectId: string
  onRestarted: () => void
}

export function ChapterNav({ chapters, currentChapter, turns, onAdvanceChapter, advancingChapter, canAdvance, projectId, onRestarted }: ChapterNavProps) {
  const [restartOpen, setRestartOpen] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const handleRestart = async () => {
    setRestarting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/restart`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to restart interview')
      toast.success('Interview restarted', { description: 'All Q&A and manuscript wiped. Project setup preserved. currentChapter reset to 1.' })
      onRestarted()
    } catch (e) {
      toast.error('Restart failed', { description: e instanceof Error ? e.message : '' })
    } finally {
      setRestarting(false)
      setRestartOpen(false)
    }
  }

  return (
    <div className="p-4">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Chapters</h3>
      <ol className="space-y-1">
        {chapters.map((c) => {
          const isCurrent = c.order === currentChapter
          const isComplete = c.status === 'complete'
          const isInProgress = c.status === 'in_progress'
          const turnCount = turns.filter((t) => t.chapterId === c.id).length
          return (
            <li key={c.id} className={`flex items-start gap-2 px-2 py-2 rounded-md text-sm ${isCurrent ? 'bg-accent/40 border border-accent/50' : ''}`}>
              <div className="flex-shrink-0 mt-0.5">
                {isComplete ? (
                  <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center"><Check className="w-2.5 h-2.5" /></span>
                ) : isCurrent ? (
                  <span className="w-4 h-4 rounded-full border-2 border-primary flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-primary" /></span>
                ) : (
                  <span className="w-4 h-4 rounded-full border border-border" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`font-serif leading-tight ${isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>{c.order}. {c.title}</div>
                {turnCount > 0 && (
                  <div className="text-xs text-muted-foreground mt-0.5">{turnCount} Q&amp;A{isInProgress && ' · writing…'}</div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      <div className="mt-4 pt-4 border-t border-border">
        <Button variant="outline" size="sm" onClick={onAdvanceChapter} disabled={advancingChapter || !canAdvance} className="w-full">
          {advancingChapter ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5 mr-1.5" />}
          Next chapter
        </Button>
        {!canAdvance && currentChapter < 11 && (
          <p className="text-xs text-muted-foreground mt-2 text-center">Answer the latest question to advance.</p>
        )}
        {currentChapter >= 11 && (
          <p className="text-xs text-muted-foreground mt-2 text-center italic">Legacy — the final chapter.</p>
        )}
      </div>
      <div className="mt-4 pt-4 border-t border-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRestartOpen(true)}
          disabled={restarting || turns.length === 0}
          className="w-full text-destructive hover:text-destructive hover:bg-destructive/5"
        >
          {restarting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 mr-1.5" />}
          Restart interview
        </Button>
        <p className="text-xs text-muted-foreground mt-1.5 text-center leading-relaxed">
          Wipes all Q&amp;A, manuscript sections, canon, and provenance for this project. Keeps the project setup.
        </p>
      </div>
      <ConfirmDialog
        open={restartOpen}
        onOpenChange={setRestartOpen}
        title="Restart this interview?"
        description="This will permanently delete every question and answer, every manuscript section, the entire character canon, all extracted entities/events/contradictions/threads, and any user corrections you've established. The project setup (character name, what-to-call, interviewer bio, corpus) will be preserved."
        confirmLabel="Restart interview"
        cancelLabel="Cancel"
        destructive
        onConfirm={handleRestart}
      />
    </div>
  )
}
