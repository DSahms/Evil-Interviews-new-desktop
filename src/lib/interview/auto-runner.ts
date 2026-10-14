/**
 * Auto-run job manager — in-memory.
 *
 * Two modes:
 *   - **Fixed-count mode**: runs `targetCount` turns in the current chapter
 *     (with optional auto-advance every N turns). Default.
 *   - **Full-interview mode** (`fullInterview: true`): runs through ALL 11
 *     chapters, doing `turnsPerChapter` turns per chapter, auto-advancing
 *     after each set. Stops when chapter 11 completes or when stopped.
 *
 * Pause/resume semantics:
 *   - The database is the pause state. Stopping a job just sets
 *     `stopRequested = true`; the running LLM call finishes cleanly, then
 *     the job ends. State (turns, chapter, manuscript) is persisted.
 *   - "Resume" starts a NEW auto-run job that picks up from the current
 *     database state (currentChapter + existing turns).
 *   - "End" stops the job and signifies the user is done with auto-run
 *     for now (no special state — just a stopped job).
 */

import { nextQuestion, answerTurn, advanceChapter, loadProjectState } from './orchestrator'

export type JobStep =
  | 'idle'
  | 'generating-question'
  | 'generating-answer'
  | 'extracting-canon'
  | 'composing-manuscript'
  | 'advancing-chapter'
  | 'done'
  | 'stopped'
  | 'error'

export interface AutoJob {
  id: string
  projectId: string
  targetCount: number          // for fixed-count mode; for full-interview mode, derived from turnsPerChapter * 11
  completedTurns: number
  currentStep: JobStep
  currentTurnId: string | null
  currentTurnQuestion: string | null
  error: string | null
  startedAt: number
  finishedAt: number | null
  stopRequested: boolean
  autoAdvanceEvery: number     // 0 = no auto-advance; for full-interview mode, = turnsPerChapter
  turnsSinceAdvance: number
  fullInterview: boolean       // true = run all 11 chapters
  turnsPerChapter: number      // for full-interview mode (default 3)
  currentChapter: number       // for full-interview mode progress display
  targetChapter: number        // 11 for full-interview mode
}

const jobs = new Map<string, AutoJob>()

function genId(): string {
  return `ar_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function startAutoRun(
  projectId: string,
  targetCount: number,
  autoAdvanceEvery = 0,
  fullInterview = false,
  turnsPerChapter = 3
): AutoJob {
  const existing = Array.from(jobs.values()).find(
    (j) => j.projectId === projectId && j.currentStep !== 'done' && j.currentStep !== 'stopped' && j.currentStep !== 'error'
  )
  if (existing) {
    throw new Error(`An auto-run is already in progress for this project (job ${existing.id}, ${existing.completedTurns}/${existing.targetCount} done). Wait for it to finish or stop it first.`)
  }

  const tpc = Math.max(1, Math.min(20, Math.floor(turnsPerChapter)))
  const tc = fullInterview ? tpc * 11 : Math.max(1, Math.min(50, Math.floor(targetCount)))
  const aae = fullInterview ? tpc : Math.max(0, Math.floor(autoAdvanceEvery))

  const job: AutoJob = {
    id: genId(),
    projectId,
    targetCount: tc,
    completedTurns: 0,
    currentStep: 'idle',
    currentTurnId: null,
    currentTurnQuestion: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    stopRequested: false,
    autoAdvanceEvery: aae,
    turnsSinceAdvance: 0,
    fullInterview,
    turnsPerChapter: tpc,
    currentChapter: 1,
    targetChapter: 11,
  }
  jobs.set(job.id, job)

  void runLoop(job).catch((e) => {
    job.currentStep = 'error'
    job.error = e instanceof Error ? e.message : String(e)
    job.finishedAt = Date.now()
  })

  return job
}

async function runLoop(job: AutoJob): Promise<void> {
  // For full-interview mode, the loop runs until targetCount turns are done
  // (targetCount = turnsPerChapter * 11). After every turnsPerChapter turns,
  // auto-advance kicks in. When the project reaches chapter 11 and completes
  // its turnsPerChapter turns there, the loop ends naturally.
  for (let i = 0; i < job.targetCount; i++) {
    if (job.stopRequested) {
      job.currentStep = 'stopped'
      job.finishedAt = Date.now()
      return
    }

    // For full-interview mode, refresh currentChapter from the database
    // so the progress display is accurate.
    if (job.fullInterview) {
      try {
        const state = await loadProjectState(job.projectId)
        job.currentChapter = state.project.currentChapter
        // If we've completed chapter 11 (the final chapter) and done
        // turnsPerChapter turns there, we're done.
        if (state.project.currentChapter >= 11) {
          const chapter = state.chapters.find((c) => c.order === 11)
          const turnsInFinal = state.turns.filter((t) => t.chapterId === chapter?.id).length
          if (turnsInFinal >= job.turnsPerChapter) {
            job.currentStep = 'done'
            job.finishedAt = Date.now()
            return
          }
        }
      } catch {
        // non-fatal
      }
    }

    job.currentStep = 'generating-question'
    job.currentTurnId = null
    job.currentTurnQuestion = null
    try {
      const { turn } = await nextQuestion(job.projectId)
      job.currentTurnId = turn.id
      job.currentTurnQuestion = turn.question
    } catch (e) {
      job.currentStep = 'error'
      job.error = `Question generation failed on turn ${i + 1}: ${e instanceof Error ? e.message : String(e)}`
      job.finishedAt = Date.now()
      return
    }

    if (job.stopRequested) {
      job.currentStep = 'stopped'
      job.finishedAt = Date.now()
      return
    }

    job.currentStep = 'generating-answer'
    try {
      await answerTurn(job.projectId, job.currentTurnId!)
    } catch (e) {
      job.currentStep = 'error'
      job.error = `Answer generation failed on turn ${i + 1}: ${e instanceof Error ? e.message : String(e)}`
      job.finishedAt = Date.now()
      return
    }
    job.currentStep = 'idle'

    job.completedTurns = i + 1
    job.turnsSinceAdvance += 1

    // Pause between turns to avoid hitting Gemini free-tier rate limits
    // (15 requests/minute on the free tier). 4 seconds gives enough headroom.
    if (i < job.targetCount - 1) {
      await new Promise((resolve) => setTimeout(resolve, 4000))
    }

    // Auto-advance when enough turns have been done in the current chapter.
    // For full-interview mode, this is how we move to the next chapter.
    if (job.autoAdvanceEvery > 0 && job.turnsSinceAdvance >= job.autoAdvanceEvery) {
      job.currentStep = 'advancing-chapter'
      try {
        const state = await loadProjectState(job.projectId)
        if (state.project.currentChapter >= 11) {
          // Already at the final chapter — don't advance further.
          job.turnsSinceAdvance = 0
          // For full-interview mode, this means we're done.
          if (job.fullInterview) {
            job.currentStep = 'done'
            job.finishedAt = Date.now()
            return
          }
        } else {
          await advanceChapter(job.projectId)
          job.turnsSinceAdvance = 0
          job.currentChapter = state.project.currentChapter + 1
        }
      } catch (e) {
        console.error('[auto-runner] chapter advance failed (non-fatal):', e instanceof Error ? e.message : e)
        job.turnsSinceAdvance = 0
      }
    }
  }

  job.currentStep = 'done'
  job.finishedAt = Date.now()
}

export function getJob(jobId: string): AutoJob | null {
  return jobs.get(jobId) ?? null
}

export function getActiveJobForProject(projectId: string): AutoJob | null {
  for (const job of jobs.values()) {
    if (job.projectId !== projectId) continue
    if (job.currentStep !== 'done' && job.currentStep !== 'stopped' && job.currentStep !== 'error') {
      return job
    }
  }
  return null
}

export function stopJob(jobId: string): boolean {
  const job = jobs.get(jobId)
  if (!job) return false
  if (job.currentStep === 'done' || job.currentStep === 'stopped' || job.currentStep === 'error') {
    return false
  }
  job.stopRequested = true
  return true
}

export function cleanupOldJobs(): void {
  const cutoff = Date.now() - 60 * 60 * 1000
  for (const [id, job] of jobs.entries()) {
    if (job.finishedAt && job.finishedAt < cutoff) {
      jobs.delete(id)
    }
  }
}
