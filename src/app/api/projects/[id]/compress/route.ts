import { NextRequest, NextResponse } from 'next/server'
import { compressChapter, compressCorpusForProject, loadProjectState } from '@/lib/interview/orchestrator'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// POST /api/projects/[id]/compress
// Body: { chapterId?: string } — if chapterId provided, compress that chapter.
// If not, compress the current chapter.
// Also can compress the corpus: { compressCorpus: true }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  try {
    if (body?.compressCorpus) {
      const summary = await compressCorpusForProject(id)
      return NextResponse.json({ summary, type: 'corpus' })
    }

    const state = await loadProjectState(id)
    const chapterId = body?.chapterId || state.chapters.find((c) => c.order === state.project.currentChapter)?.id
    if (!chapterId) {
      return NextResponse.json({ error: 'No chapter to compress' }, { status: 400 })
    }

    const summary = await compressChapter(id, chapterId)
    const chapter = state.chapters.find((c) => c.id === chapterId)
    return NextResponse.json({
      summary,
      type: 'chapter',
      chapterOrder: chapter?.order,
      chapterTitle: chapter?.title,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Compression failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
