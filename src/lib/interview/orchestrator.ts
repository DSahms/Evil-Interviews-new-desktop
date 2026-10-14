/**
 * Interview orchestration — the simplified three-tier pipeline.
 *
 * SERVICE 1 (Interview Engine):
 *   nextQuestion → answerTurn
 *   Prompt: system prompt + context_block (summary) + last 4-6 messages
 *   NO canon, NO entities, NO corpus retrieval in the prompt.
 *
 * SERVICE 2 (Context Compressor):
 *   compressChapter — called when advancing chapters
 *   Summarizes the chapter's turns into 150-250 words → stored in chapter.sessionSummary
 *   Also: summarizeCorpusForProject — called at project creation
 *   Summarizes the corpus into 150-250 words → stored in project.characterSummary
 *
 * SERVICE 3 (Narrative Service):
 *   On-demand only — user clicks "Generate Chapter"
 *   Retrieves full raw Q&A, generates first-person prose
 */

import { db } from '@/lib/db'
import { readCorpus } from '@/lib/storage/paths'
import { CHAPTERS } from '@/lib/interview/chapters'
import { generateQuestion, InterviewerContext } from '@/lib/llm/engines/interviewer'
import { generateAnswer, SubjectContext } from '@/lib/llm/engines/subject'
import { summarizeSession, summarizeCorpus } from '@/lib/llm/engines/compressor'
import { composeChapterNarrative, NarrativeContext } from '@/lib/llm/engines/composition'

export async function ensureChapters(projectId: string): Promise<void> {
  const existing = await db.chapter.findMany({ where: { projectId }, orderBy: { order: 'asc' } })
  if (existing.length >= CHAPTERS.length) return
  for (const c of CHAPTERS) {
    const exists = existing.find((e) => e.order === c.order)
    if (!exists) {
      await db.chapter.create({
        data: { projectId, order: c.order, title: c.title, manuscriptSection: '', status: 'pending' },
      })
    }
  }
}

export async function loadProjectState(projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) throw new Error('Project not found')
  await ensureChapters(projectId)
  const chapters = await db.chapter.findMany({ where: { projectId }, orderBy: { order: 'asc' } })
  const turns = await db.turn.findMany({ where: { projectId }, orderBy: [{ chapterId: 'asc' }, { order: 'asc' }] })
  const canon = await db.canon.findMany({ where: { projectId } })
  const entities = await db.entity.findMany({ where: { projectId }, orderBy: { mentions: 'desc' } })
  const contradictions = await db.contradiction.findMany({ where: { projectId } })
  const unresolvedThreads = await db.unresolvedThread.findMany({ where: { projectId }, orderBy: { updatedAt: 'desc' } })
  const corrections = await db.userCorrection.findMany({ where: { projectId } })
  const corpusMd = await readCorpus(project.corpusPath)
  return { project, chapters, turns, canon, entities, contradictions, unresolvedThreads, corrections, corpusMd }
}

/**
 * Build chapter summaries for the context_block.
 * Returns all completed chapters' summaries (excluding the current chapter).
 */
function getChapterSummaries(
  chapters: { id: string; order: number; title: string; sessionSummary: string; status: string }[],
  currentChapterOrder: number
): { title: string; summary: string }[] {
  return chapters
    .filter((c) => c.order < currentChapterOrder && c.sessionSummary)
    .map((c) => ({ title: c.title, summary: c.sessionSummary }))
}

/**
 * SERVICE 1: Generate the next question.
 * Prompt: system prompt + context_block (character summary + chapter summaries) + last 4-6 messages
 */
export async function nextQuestion(projectId: string, chapterOrder?: number): Promise<{ turn: { id: string; question: string; chapterOrder: number; chapterTitle: string; order: number } }> {
  const state = await loadProjectState(projectId)
  const order = chapterOrder ?? state.project.currentChapter
  const chapter = state.chapters.find((c) => c.order === order)
  if (!chapter) throw new Error(`Chapter ${order} not found`)

  const turnsInChapter = state.turns.filter((t) => t.chapterId === chapter.id)
  const nextOrder = (turnsInChapter.at(-1)?.order ?? 0) + 1

  const chapterSummaries = getChapterSummaries(state.chapters, order)

  const ctx: InterviewerContext = {
    project: {
      id: state.project.id,
      characterName: state.project.characterName,
      whatToCall: state.project.whatToCall,
      interviewerBio: state.project.interviewerBio,
      corpusPath: state.project.corpusPath,
      characterSummary: state.project.characterSummary,
    },
    chapterTitle: chapter.title,
    chapterOrder: chapter.order,
    recentTurns: state.turns.slice(-6),
    chapterSummaries,
  }

  const question = await generateQuestion(ctx)

  if (chapter.status === 'pending') {
    await db.chapter.update({ where: { id: chapter.id }, data: { status: 'in_progress' } })
  }

  const turn = await db.turn.create({
    data: {
      projectId,
      chapterId: chapter.id,
      order: nextOrder,
      question,
      answer: '',
      manuscriptPart: '',
      status: 'questioned',
    },
  })

  return {
    turn: {
      id: turn.id,
      question: turn.question,
      chapterOrder: chapter.order,
      chapterTitle: chapter.title,
      order: turn.order,
    },
  }
}

/**
 * SERVICE 1: Generate the answer.
 * Prompt: system prompt + context_block + last 4-6 messages
 * NO per-turn canon extraction, NO per-turn manuscript composition, NO per-turn narrative.
 * The interview loop is just: question → answer. Fast, simple, clean.
 */
export async function answerTurn(projectId: string, turnId: string): Promise<{
  answer: string
}> {
  const state = await loadProjectState(projectId)
  const turn = await db.turn.findUnique({ where: { id: turnId } })
  if (!turn) throw new Error('Turn not found')
  const chapter = state.chapters.find((c) => c.id === turn.chapterId)
  if (!chapter) throw new Error('Chapter not found')

  const chapterSummaries = getChapterSummaries(state.chapters, chapter.order)

  const subjectCtx: SubjectContext = {
    project: {
      id: state.project.id,
      characterName: state.project.characterName,
      whatToCall: state.project.whatToCall,
      corpusPath: state.project.corpusPath,
      characterSummary: state.project.characterSummary,
    },
    chapterTitle: chapter.title,
    chapterOrder: chapter.order,
    question: turn.question,
    recentTurns: state.turns.slice(-6),
    chapterSummaries,
  }

  const answer = await generateAnswer(subjectCtx)
  await db.turn.update({ where: { id: turn.id }, data: { answer, status: 'answered' } })

  return { answer }
}

/**
 * SERVICE 2: Compress a chapter's turns into a 150-250 word summary.
 * Called when advancing chapters (or on-demand).
 */
export async function compressChapter(projectId: string, chapterId: string): Promise<string> {
  const state = await loadProjectState(projectId)
  const chapter = state.chapters.find((c) => c.id === chapterId)
  if (!chapter) throw new Error('Chapter not found')
  const turnsInChapter = state.turns.filter((t) => t.chapterId === chapter.id).sort((a, b) => a.order - b.order)
  if (turnsInChapter.length === 0) return ''

  const summary = await summarizeSession(state.project.whatToCall, turnsInChapter)
  await db.chapter.update({ where: { id: chapter.id }, data: { sessionSummary: summary } })
  return summary
}

/**
 * SERVICE 2: Compress the corpus into a character summary.
 * Called at project creation. Stored in project.characterSummary.
 */
export async function compressCorpusForProject(projectId: string): Promise<string> {
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) throw new Error('Project not found')
  const corpusMd = await readCorpus(project.corpusPath)
  if (!corpusMd.trim()) return ''

  const summary = await summarizeCorpus(project.characterName, project.whatToCall, corpusMd)
  await db.project.update({ where: { id: projectId }, data: { characterSummary: summary } })
  return summary
}

/**
 * Advance to the next chapter. Compresses the current chapter first.
 */
export async function advanceChapter(projectId: string): Promise<number> {
  const state = await loadProjectState(projectId)
  const current = state.project.currentChapter
  if (current >= 11) throw new Error('Already at the final chapter')
  const next = current + 1

  // Compress the current chapter + generate its narrative BEFORE advancing.
  // This way, by the time the user reaches Chapter 11, Chapters 1-10 are
  // already compressed AND narrated. Export is instant — just concatenation.
  const cur = state.chapters.find((c) => c.order === current)
  if (cur) {
    const turnsInChapter = state.turns.filter((t) => t.chapterId === cur.id)
    if (turnsInChapter.length > 0) {
      // Step 1: Compress the chapter into a 150-250 word summary
      try {
        await compressChapter(projectId, cur.id)
      } catch (e) {
        console.error('[orchestrator] chapter compression failed (non-fatal):', e instanceof Error ? e.message : e)
      }

      // Step 2: Generate the first-person narrative for this chapter
      // (one LLM call, ~30-60s). Stored in chapter.manuscriptSection.
      try {
        const ctx: NarrativeContext = {
          project: {
            id: state.project.id,
            characterName: state.project.characterName,
            whatToCall: state.project.whatToCall,
            corpusPath: state.project.corpusPath,
          },
          chapterTitle: cur.title,
          turns: turnsInChapter.sort((a, b) => a.order - b.order),
        }
        const narrative = await composeChapterNarrative(ctx)
        await db.chapter.update({ where: { id: cur.id }, data: { manuscriptSection: narrative } })
      } catch (e) {
        console.error('[orchestrator] chapter narrative generation failed (non-fatal):', e instanceof Error ? e.message : e)
      }
    }
    await db.chapter.update({ where: { id: cur.id }, data: { status: 'complete' } })
  }

  await db.project.update({ where: { id: projectId }, data: { currentChapter: next } })
  return next
}

/**
 * Regenerate question (keeps answer if any).
 */
export async function regenerateQuestion(projectId: string, turnId: string): Promise<string> {
  const state = await loadProjectState(projectId)
  const turn = await db.turn.findUnique({ where: { id: turnId } })
  if (!turn) throw new Error('Turn not found')
  const chapter = state.chapters.find((c) => c.id === turn.chapterId)
  if (!chapter) throw new Error('Chapter not found')

  const chapterSummaries = getChapterSummaries(state.chapters, chapter.order)

  const ctx: InterviewerContext = {
    project: {
      id: state.project.id,
      characterName: state.project.characterName,
      whatToCall: state.project.whatToCall,
      interviewerBio: state.project.interviewerBio,
      corpusPath: state.project.corpusPath,
      characterSummary: state.project.characterSummary,
    },
    chapterTitle: chapter.title,
    chapterOrder: chapter.order,
    recentTurns: state.turns.filter((t) => t.order < turn.order || t.chapterId !== chapter.id).slice(-6),
    chapterSummaries,
  }

  const newQuestion = await generateQuestion(ctx)
  await db.turn.update({
    where: { id: turn.id },
    data: { question: newQuestion, regeneratedFromId: turn.id, status: 'regenerated' },
  })
  return newQuestion
}
