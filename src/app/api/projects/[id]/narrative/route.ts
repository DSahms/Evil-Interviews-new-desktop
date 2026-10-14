import { NextRequest, NextResponse } from 'next/server'
import { startNarrativeJob, getActiveNarrativeJobForProject, cleanupOldNarrativeJobs } from '@/lib/interview/narrative-runner'

export const dynamic = 'force-dynamic'

// POST /api/projects/[id]/narrative — start a background narrative export job
// Returns: { jobId, startedAt }
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  cleanupOldNarrativeJobs()

  const existing = getActiveNarrativeJobForProject(id)
  if (existing) {
    return NextResponse.json({
      error: 'A narrative export is already in progress for this project.',
      jobId: existing.id,
      progress: existing.progress,
      message: existing.message,
    }, { status: 409 })
  }

  try {
    const job = startNarrativeJob(id)
    return NextResponse.json({
      jobId: job.id,
      startedAt: job.startedAt,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to start narrative export'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// GET /api/projects/[id]/narrative — check if a narrative job is active
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  cleanupOldNarrativeJobs()
  const job = getActiveNarrativeJobForProject(id)
  if (!job) {
    return NextResponse.json({ active: false })
  }
  return NextResponse.json({
    active: true,
    job: {
      id: job.id,
      currentStep: job.currentStep,
      progress: job.progress,
      message: job.message,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    },
  })
}
