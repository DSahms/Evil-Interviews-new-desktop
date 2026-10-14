/**
 * Export utilities.
 *
 * The user wants 3 outputs (their custom requirement):
 *   1. Markdown magazine-style Q&A — "ask a question, get an answer, continue"
 *   2. First-person encounter story from the character's POV — the character
 *      says who it is (a continuous narrative, like "Interview with the
 *      Vampire" the novel, not the transcript)
 *   3. Q&A with audio output — TTS for listening
 *
 * Plus the original "manuscript" output that grew during the interview,
 * exported as PDF + Markdown + DOCX.
 *
 * Layout of generated files: /home/z/my-project/data/projects/<id>/exports/
 */

import path from 'node:path'
import { db } from '@/lib/db'
import { ensureProjectDirs, readCorpus, writeExport } from '@/lib/storage/paths'
import { CHAPTERS } from '@/lib/interview/chapters'

/**
 * Magazine-style Q&A in Markdown — flows like a magazine interview:
 *
 *   # Interviews with Evil: <Character>
 *
 *   ## Chapter 1 — Origins
 *
 *   **Q:** ...
 *
 *   **A:** ...
 *
 *   **Q:** ...
 *
 *   **A:** ...
 *
 *   ## Chapter 2 — Childhood
 *   ...
 */
export async function exportMagazineQA(projectId: string): Promise<{ content: string; path: string }> {
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) throw new Error('Project not found')
  const chapters = await db.chapter.findMany({ where: { projectId }, orderBy: { order: 'asc' } })
  const turns = await db.turn.findMany({ where: { projectId }, orderBy: [{ chapterId: 'asc' }, { order: 'asc' }] })

  const lines: string[] = []
  lines.push(`# Interviews with Evil: ${project.characterName}`)
  lines.push('')
  lines.push(`*A long-form magazine-style interview with ${project.whatToCall}.*`)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const chapter of chapters) {
    const chapterTurns = turns.filter((t) => t.chapterId === chapter.id)
    if (chapterTurns.length === 0) continue
    lines.push(`## Chapter ${chapter.order} — ${chapter.title}`)
    lines.push('')
    for (const turn of chapterTurns) {
      lines.push(`**Q:** ${turn.question}`)
      lines.push('')
      lines.push(`**A:** ${turn.answer || '(no answer recorded)'}`)
      lines.push('')
    }
    lines.push('---')
    lines.push('')
  }

  const content = lines.join('\n')
  const filepath = await writeExport(projectId, 'magazine-qa.md', content)
  return { content, path: filepath }
}

/**
 * First-person encounter story from the character's POV. This calls the
 * narrative composition engine, which takes all Q&A + canon and weaves a
 * single continuous first-person story.
 *
 * Output is markdown. Also re-renders as PDF in the export pipeline.
 */
/**
 * First-person narrative — now generated on-demand via the
 * /api/projects/[id]/generate-narrative endpoint (Service 3).
 * This function is kept for backward compat — it returns the pre-written
 * narrative if available, or an empty string if not yet generated.
 */
export async function exportFirstPersonNarrative(projectId: string): Promise<{ content: string; path: string }> {
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) throw new Error('Project not found')
  // Return the concatenated chapter narratives (already written during
  // chapter advancement — instant, no LLM call needed).
  const chapters = await db.chapter.findMany({ where: { projectId }, orderBy: { order: 'asc' } })
  const narratives = chapters.filter((c) => c.manuscriptSection)
  if (narratives.length === 0) {
    return { content: '(No narrative generated yet. Complete chapters and advance to generate narratives.)', path: '' }
  }
  const content = narratives.map((c) => c.manuscriptSection).join('\n\n')
  const filepath = await writeExport(projectId, 'first-person-narrative.md', content)
  return { content, path: filepath }
}

/**
 * Combined export — ONE markdown file with both Q&A and first-person
 * narrative, with YAML front matter for ingestion into the reader app.
 *
 * Structure:
 *   ---
 *   entity_id: "jersey_devil"
 *   entity_name: "The Jersey Devil"
 *   category: "fictional"
 *   audio_tracks:
 *     - title: "First-Person Perspective"
 *       file: "first_person_audio.mp3"
 *     - title: "The Interview Q&A"
 *       file: "qa_audio.mp3"
 *   baseline_image: "jersey_devil_anchor.png"
 *   ---
 *
 *   # The Jersey Devil
 *
 *   ## Part I: First-Person Narrative
 *   [narrative text]
 *
 *   ---
 *
 *   ## Part II: The Interview
 *   [Q&A text]
 */
export async function exportCombined(projectId: string): Promise<{ content: string; path: string }> {
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) throw new Error('Project not found')

  // Part 1: First-person narrative (from chapter manuscripts — already written)
  const chapters = await db.chapter.findMany({ where: { projectId }, orderBy: { order: 'asc' } })
  const narratives = chapters.filter((c) => c.manuscriptSection)
  const narrativeText = narratives.length > 0
    ? narratives.map((c) => c.manuscriptSection).join('\n\n')
    : '(No narrative generated yet. Complete chapters and advance to generate narratives.)'

  // Part 2: Q&A magazine style (from turns — instant)
  const turns = await db.turn.findMany({
    where: { projectId },
    orderBy: [{ chapterId: 'asc' }, { order: 'asc' }],
  })
  const qaLines: string[] = []
  for (const chapter of chapters) {
    const chapterTurns = turns.filter((t) => t.chapterId === chapter.id)
    if (chapterTurns.length === 0) continue
    qaLines.push(`## Chapter ${chapter.order} — ${chapter.title}`)
    qaLines.push('')
    for (const turn of chapterTurns) {
      qaLines.push(`**Q:** ${turn.question}`)
      qaLines.push('')
      qaLines.push(`**A:** ${turn.answer || '(no answer recorded)'}`)
      qaLines.push('')
    }
    qaLines.push('---')
    qaLines.push('')
  }
  const qaText = qaLines.join('\n')

  // YAML front matter
  const slug = project.characterName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const yaml = `---
entity_id: "${slug}"
entity_name: "${project.characterName}"
category: "fictional"
audio_tracks:
  - title: "First-Person Perspective"
    file: "${slug}_narrative_audio.mp3"
  - title: "The Interview Q&A"
    file: "${slug}_qa_audio.mp3"
baseline_image: "${slug}_anchor.png"
---`

  const content = `${yaml}

# ${project.characterName}

## Part I: First-Person Narrative

${narrativeText}

---

## Part II: The Interview

${qaText}`

  const filepath = await writeExport(projectId, 'combined.md', content)
  return { content, path: filepath }
}
export async function exportManuscriptMarkdown(projectId: string): Promise<{ content: string; path: string }> {
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) throw new Error('Project not found')
  const chapters = await db.chapter.findMany({ where: { projectId }, orderBy: { order: 'asc' } })

  const lines: string[] = []
  lines.push(`# ${project.characterName}`)
  lines.push('')
  lines.push(`*A long-form manuscript, written chapter by chapter as the interview progressed.*`)
  lines.push('')
  lines.push('---')
  lines.push('')
  for (const chapter of chapters) {
    if (!chapter.manuscriptSection) continue
    lines.push(`## Chapter ${chapter.order} — ${chapter.title}`)
    lines.push('')
    lines.push(chapter.manuscriptSection)
    lines.push('')
    lines.push('---')
    lines.push('')
  }
  const content = lines.join('\n')
  const filepath = await writeExport(projectId, 'manuscript.md', content)
  return { content, path: filepath }
}

/**
 * Manuscript PDF — generated from the manuscript markdown using the pdf
 * skill approach (ReportLab). For v1 we generate a literary-styled PDF.
 */
export async function exportManuscriptPDF(projectId: string): Promise<{ path: string; buffer: Buffer }> {
  // We delegate to the pdf skill approach — for now, generate via the same
  // script-based ReportLab pipeline that the pdf skill would use.
  // Implemented in /api/projects/[id]/export route via a subprocess call.
  // This stub is here for type completeness; actual generation happens in
  // the API route.
  await ensureProjectDirs(projectId)
  throw new Error('PDF export implemented in API route via pdf skill subprocess')
}

/**
 * Manuscript DOCX — generated using the docx skill approach (python-docx).
 * Same approach as PDF — delegated to the API route.
 */
export async function exportManuscriptDOCX(_projectId: string): Promise<{ path: string; buffer: Buffer }> {
  throw new Error('DOCX export implemented in API route via docx skill subprocess')
}
