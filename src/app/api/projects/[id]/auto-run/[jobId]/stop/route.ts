import { NextRequest, NextResponse } from 'next/server'
import { stopJob } from '@/lib/interview/auto-runner'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  const { jobId } = await params
  const ok = stopJob(jobId)
  if (!ok) {
    return NextResponse.json({ error: 'Job not found or already finished.' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, message: 'Stop requested. The job will finish the current in-flight step and then stop.' })
}
