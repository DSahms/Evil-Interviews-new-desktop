import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { readCorpus, writeExport } from '@/lib/storage/paths'
import { composeChapterNarrative, NarrativeContext } from '@/lib/llm/engines/composition'
import type { Turn } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST /api/projects/[id]/generate-narrative
// Body: { chapterOrder?: number } — if provided, generate for that chapter.
// If not, generate for the current chapter.
// Generates first-person narrative prose from the full raw Q&A.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  try {
    const project = await db.project.findUnique({ where: { id } })
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const chapters = await db.chapter.findMany({ where: { projectId: id }, orderBy: { order: 'asc' } })
    const chapterOrder = body?.chapterOrder ?? project.currentChapter
    const chapter = chapters.find((c) => c.order === chapterOrder)
    if (!chapter) return NextResponse.json({ error: 'Chapter not found' }, { status: 404 })

    const turns = await db.turn.findMany({
      where: { projectId: id, chapterId: chapter.id },
      orderBy: { order: 'asc' },
    }) as Turn[]

    if (turns.length === 0) {
      return NextResponse.json({ error: 'No Q&A in this chapter yet. Run an interview first.' }, { status: 400 })
    }

    const corpusMd = await readCorpus(project.corpusPath)

    const ctx: NarrativeContext = {
      project: {
        id: project.id,
        characterName: project.characterName,
        whatToCall: project.whatToCall,
        corpusPath: project.corpusPath,
      },
      chapterTitle: chapter.title,
      turns,
      corpusMd,
    }

    const narrative = await composeChapterNarrative(ctx)

    // Save to chapter's manuscriptSection
    await db.chapter.update({ where: { id: chapter.id }, data: { manuscriptSection: narrative } })

    // Also save to disk
    const filepath = await writeExport(id, `chapter-${chapterOrder}-narrative.md`, narrative)

    return NextResponse.json({
      narrative,
      path: filepath,
      chapterOrder,
      chapterTitle: chapter.title,
      turnCount: turns.length,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Narrative generation failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
