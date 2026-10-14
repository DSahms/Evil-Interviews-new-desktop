import { NextRequest, NextResponse } from 'next/server'
import { getNarrativeJob, cleanupOldNarrativeJobs } from '@/lib/interview/narrative-runner'

export const dynamic = 'force-dynamic'

// GET /api/projects/[id]/narrative/[jobId] — poll narrative job status
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  const { jobId } = await params
  cleanupOldNarrativeJobs()
  const job = getNarrativeJob(jobId)
  if (!job) {
    return NextResponse.json({ error: 'Job not found. It may have been cleaned up after a server restart.' }, { status: 404 })
  }
  return NextResponse.json({
    id: job.id,
    projectId: job.projectId,
    currentStep: job.currentStep,
    progress: job.progress,
    message: job.message,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    // Do NOT return content here — it can be large. The /result endpoint
    // returns the content when the job is done.
  })
}
