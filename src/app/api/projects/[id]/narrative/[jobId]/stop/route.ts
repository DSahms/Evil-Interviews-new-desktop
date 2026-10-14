import { NextRequest, NextResponse } from 'next/server'
import { stopNarrativeJob } from '@/lib/interview/narrative-runner'

export const dynamic = 'force-dynamic'

// POST /api/projects/[id]/narrative/[jobId]/stop — request cancellation
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  const { jobId } = await params
  const ok = stopNarrativeJob(jobId)
  if (!ok) {
    return NextResponse.json({ error: 'Job not found or already finished.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, message: 'Stop requested. The job will stop at the next checkpoint.' })
}
