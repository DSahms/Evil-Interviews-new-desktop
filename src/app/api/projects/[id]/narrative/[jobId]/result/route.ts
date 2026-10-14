import { NextRequest, NextResponse } from 'next/server'
import { getNarrativeJob } from '@/lib/interview/narrative-runner'

export const dynamic = 'force-dynamic'

// GET /api/projects/[id]/narrative/[jobId]/result — fetch the generated
// narrative markdown when the job is done. Returns the content as JSON
// `{ content, path }` so the UI can trigger a download.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  const { jobId } = await params
  const job = getNarrativeJob(jobId)
  if (!job) {
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 })
  }
  if (job.currentStep !== 'done') {
    return NextResponse.json({
      error: `Job is not done yet. Current step: ${job.currentStep}`,
      currentStep: job.currentStep,
      progress: job.progress,
    }, { status: 409 })
  }
  return NextResponse.json({
    content: job.content,
    path: job.outputPath,
    format: 'first-person-narrative',
  })
}
