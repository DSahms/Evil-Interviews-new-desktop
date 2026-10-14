import { NextRequest, NextResponse } from 'next/server'
import { getJob, cleanupOldJobs } from '@/lib/interview/auto-runner'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  const { jobId } = await params
  cleanupOldJobs()
  const job = getJob(jobId)
  if (!job) {
    return NextResponse.json({ error: 'Job not found. It may have been cleaned up after a server restart.' }, { status: 404 })
  }
  return NextResponse.json({
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
  })
}
