/**
 * Narrative export job manager — in-memory.
 *
 * The first-person narrative export is a long-running LLM call (maxTokens
 * ~4000, takes 60-180s typically). Single HTTP requests time out at ~50%
 * rate. Instead, we kick off the generation as a background job and the
 * UI polls for status. When done, the UI fetches the result.
 *
 * Pattern mirrors auto-runner.ts: module-level Map of jobs, async IIFE
 * runs the work, status endpoint returns progress.
 */

import { db } from '@/lib/db'
import { readCorpus, writeExport } from '@/lib/storage/paths'
import { composeChapterNarrative } from '@/lib/llm/engines/composition'

export type NarrativeStep =
  | 'idle'
  | 'retrieving-context'
  | 'generating-narrative'
  | 'saving'
  | 'done'
  | 'stopped'
  | 'error'

export interface NarrativeJob {
  id: string
  projectId: string
  currentStep: NarrativeStep
  progress: number  // 0–100
  message: string
  content: string | null   // the generated narrative markdown, set when done
  outputPath: string | null  // filesystem path to the saved file
  error: string | null
  startedAt: number
  finishedAt: number | null
  stopRequested: boolean
}

const jobs = new Map<string, NarrativeJob>()

function genId(): string {
  return `nar_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function startNarrativeJob(projectId: string): NarrativeJob {
  // Refuse if a job is already running for this project.
  const existing = Array.from(jobs.values()).find(
    (j) => j.projectId === projectId && j.currentStep !== 'done' && j.currentStep !== 'stopped' && j.currentStep !== 'error'
  )
  if (existing) {
    throw new Error(`A narrative export is already in progress for this project (job ${existing.id}).`)
  }

  const job: NarrativeJob = {
    id: genId(),
    projectId,
    currentStep: 'idle',
    progress: 0,
    message: 'Starting…',
    content: null,
    outputPath: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    stopRequested: false,
  }
  jobs.set(job.id, job)

  void runNarrativeLoop(job).catch((e) => {
    job.currentStep = 'error'
    job.error = e instanceof Error ? e.message : String(e)
    job.finishedAt = Date.now()
  })

  return job
}

async function runNarrativeLoop(job: NarrativeJob): Promise<void> {
  try {
    if (job.stopRequested) {
      job.currentStep = 'stopped'
      job.finishedAt = Date.now()
      return
    }

    job.currentStep = 'retrieving-context'
    job.progress = 10
    job.message = 'Loading project state and corpus…'

    // Wipe the existing incremental narrative so this regeneration starts
    // from scratch. (The incremental narrative is built per-turn; the
    // background job is for regenerating the whole thing as a one-shot,
    // which is a different output — it weaves ALL Q&A into a single
    // narrative, not a per-turn accumulation.)
    // Note: this is intentional — the user can choose between the
    // incremental narrative (instant, per-turn) OR the regenerated
    // one-shot narrative (longer but cohesive across the whole interview).

    const project = await db.project.findUnique({ where: { id: job.projectId } })
    if (!project) throw new Error('Project not found')
    const turns = await db.turn.findMany({
      where: { projectId: job.projectId },
      orderBy: [{ chapterId: 'asc' }, { order: 'asc' }],
    })
    const canon = await db.canon.findMany({ where: { projectId: job.projectId } })
    const corpusMd = await readCorpus(project.corpusPath)

    if (turns.length === 0) {
      throw new Error('No Q&A in this project yet. Run an interview first, then export the narrative.')
    }

    if (job.stopRequested) {
      job.currentStep = 'stopped'
      job.finishedAt = Date.now()
      return
    }

    job.currentStep = 'generating-narrative'
    job.progress = 30
    job.message = `Generating first-person narrative from ${turns.length} Q&A exchanges… (this can take 1–3 minutes)`

    // Generate the narrative by composing each chapter's Q&A into prose,
    // then concatenating all chapters into one continuous narrative.
    const chapters = await db.chapter.findMany({
      where: { projectId: job.projectId },
      orderBy: { order: 'asc' },
    })
    const allTurnsByChapter = await db.turn.findMany({
      where: { projectId: job.projectId },
      orderBy: [{ chapterId: 'asc' }, { order: 'asc' }],
    })

    let narrative = ''
    let chapterIndex = 0
    for (const ch of chapters) {
      chapterIndex++
      const chTurns = allTurnsByChapter.filter((t) => t.chapterId === ch.id && t.answer)
      if (chTurns.length === 0) continue

      job.progress = 20 + Math.round((chapterIndex / chapters.length) * 60)
      job.message = `Generating chapter ${ch.order}: ${ch.title} (${chTurns.length} Q&A)…`

      const chNarrative = await composeChapterNarrative({
        project: {
          id: project.id,
          characterName: project.characterName,
          whatToCall: project.whatToCall,
          corpusPath: project.corpusPath,
        },
        chapterTitle: ch.title,
        turns: chTurns,
        corpusMd,
      })

      if (narrative) narrative += '\n\n'
      narrative += chNarrative

      if (job.stopRequested) {
        job.currentStep = 'stopped'
        job.finishedAt = Date.now()
        return
      }
    }

    const content = narrative

    if (job.stopRequested) {
      job.currentStep = 'stopped'
      job.finishedAt = Date.now()
      return
    }

    job.currentStep = 'saving'
    job.progress = 90
    job.message = 'Saving narrative to disk…'
    job.content = content
    const outputPath = await writeExport(job.projectId, 'first-person-narrative.md', content)
    job.outputPath = outputPath

    job.currentStep = 'done'
    job.progress = 100
    job.message = `Narrative complete — ${content.length} chars.`
    job.finishedAt = Date.now()
  } catch (e) {
    job.currentStep = 'error'
    job.error = e instanceof Error ? e.message : String(e)
    job.finishedAt = Date.now()
  }
}

export function getNarrativeJob(jobId: string): NarrativeJob | null {
  return jobs.get(jobId) ?? null
}

export function getActiveNarrativeJobForProject(projectId: string): NarrativeJob | null {
  for (const job of jobs.values()) {
    if (job.projectId !== projectId) continue
    if (job.currentStep !== 'done' && job.currentStep !== 'stopped' && job.currentStep !== 'error') {
      return job
    }
  }
  return null
}

export function stopNarrativeJob(jobId: string): boolean {
  const job = jobs.get(jobId)
  if (!job) return false
  if (job.currentStep === 'done' || job.currentStep === 'stopped' || job.currentStep === 'error') {
    return false
  }
  job.stopRequested = true
  return true
}

export function cleanupOldNarrativeJobs(): void {
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const [id, job] of jobs.entries()) {
    if (job.finishedAt && job.finishedAt < cutoff) {
      jobs.delete(id)
    }
  }
}
