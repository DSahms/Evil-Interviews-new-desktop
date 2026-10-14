import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { CHAPTERS } from '@/lib/interview/chapters'

export const dynamic = 'force-dynamic'

/**
 * POST /api/projects/[id]/restart
 * Wipes interview state (turns, chapter manuscripts, canon, entities, events,
 * contradictions, unresolved threads, user corrections) but keeps the project
 * setup (character name, what-to-call, interviewer bio, corpus path).
 * Resets currentChapter to 1.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const project = await db.project.findUnique({ where: { id } })
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  await db.turn.deleteMany({ where: { projectId: id } })
  await db.canon.deleteMany({ where: { projectId: id } })
  await db.entity.deleteMany({ where: { projectId: id } })
  await db.event.deleteMany({ where: { projectId: id } })
  await db.contradiction.deleteMany({ where: { projectId: id } })
  await db.unresolvedThread.deleteMany({ where: { projectId: id } })
  await db.userCorrection.deleteMany({ where: { projectId: id } })

  await db.chapter.deleteMany({ where: { projectId: id } })
  for (const c of CHAPTERS) {
    await db.chapter.create({
      data: {
        projectId: id,
        order: c.order,
        title: c.title,
        manuscriptSection: '',
        status: 'pending',
      },
    })
  }

  await db.project.update({ where: { id }, data: { currentChapter: 1, status: 'active' } })

  return NextResponse.json({
    ok: true,
    message: 'Interview restarted. Project setup preserved; all Q&A, manuscript, canon, and provenance wiped. currentChapter reset to 1.',
  })
}
