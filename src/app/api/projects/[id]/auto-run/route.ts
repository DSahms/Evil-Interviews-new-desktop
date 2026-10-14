import { NextRequest, NextResponse } from 'next/server'
import { startAutoRun, getActiveJobForProject, cleanupOldJobs } from '@/lib/interview/auto-runner'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const count = typeof body?.count === 'number' ? body.count : 5
  const autoAdvanceEvery = typeof body?.autoAdvanceEvery === 'number' ? body.autoAdvanceEvery : 0
  const fullInterview = Boolean(body?.fullInterview)
  const turnsPerChapter = typeof body?.turnsPerChapter === 'number' ? body.turnsPerChapter : 3

  const existing = getActiveJobForProject(id)
  if (existing) {
    return NextResponse.json({
      error: 'An auto-run is already in progress for this project.',
      jobId: existing.id,
      completedTurns: existing.completedTurns,
      targetCount: existing.targetCount,
    }, { status: 409 })
  }

  try {
    const job = startAutoRun(id, count, autoAdvanceEvery, fullInterview, turnsPerChapter)
    return NextResponse.json({
      jobId: job.id,
      targetCount: job.targetCount,
      autoAdvanceEvery: job.autoAdvanceEvery,
      fullInterview: job.fullInterview,
      turnsPerChapter: job.turnsPerChapter,
      currentChapter: job.currentChapter,
      targetChapter: job.targetChapter,
      startedAt: job.startedAt,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to start auto-run'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  cleanupOldJobs()
  const job = getActiveJobForProject(id)
  if (!job) {
    return NextResponse.json({ active: false })
  }
  return NextResponse.json({
    active: true,
    job: {
      id: job.id,
      projectId: job.projectId,
      targetCount: job.targetCount,
      completedTurns: job.completedTurns,
      currentStep: job.currentStep,
      currentTurnId: job.currentTurnId,
      currentTurnQuestion: job.currentTurnQuestion,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      autoAdvanceEvery: job.autoAdvanceEvery,
      fullInterview: job.fullInterview,
      turnsPerChapter: job.turnsPerChapter,
      currentChapter: job.currentChapter,
      targetChapter: job.targetChapter,
    },
  })
}
