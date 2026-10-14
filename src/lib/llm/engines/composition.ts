/**
 * Narrative Service — Service 3 (The Book Builder)
 *
 * Based on the working app's NarrativeService.dart.
 *
 * ON-DEMAND ONLY: retrieves the full raw Q&A for a chapter and generates
 * first-person narrative prose. This is the only service that processes
 * large text. The interview loop (Service 1) does NOT call this — it's
 * triggered by the user clicking "Generate Chapter".
 *
 * Per-turn manuscript composition has been REMOVED — the working app
 * generates the narrative on-demand, not incrementally. This simplifies
 * the interview loop and eliminates the per-turn composition LLM call.
 */

import { chatCompletion, ChatMessage } from '../provider'
import { sanitizeManuscript } from '../sanitize'
import type { Project, Turn } from '@prisma/client'

export interface NarrativeContext {
  project: Pick<Project, 'id' | 'characterName' | 'whatToCall' | 'corpusPath'>
  chapterTitle: string
  turns: Turn[]
  corpusMd?: string
}

const SYSTEM_PROMPT = (ctx: NarrativeContext): string => `You are a ghostwriter converting interview transcripts into first-person narrative prose.

You will receive raw Q&A from an interview session — the interviewer's questions and ${ctx.project.whatToCall}'s answers. Your job is to transform this into warm, readable first-person narrative as if ${ctx.project.whatToCall} wrote it themselves.

RULES:
- Write in first person. ${ctx.project.whatToCall} is the narrator.
- Preserve every fact, name, date, and detail from the answers. Do not invent anything.
- Preserve ${ctx.project.whatToCall}'s voice and vocabulary. If they said "pop" not "dad", use "pop."
- Weave the interviewer's questions into natural narrative flow — do not include Q&A format.
- Preserve sensory details exactly as shared: smells, sounds, textures, visual descriptions.
- Preserve emotional truth. If they said something made them angry, don't soften it.
- Organize into natural paragraphs. Each paragraph should cover one scene, memory, or thought.
- Do not add literary flourishes the subject wouldn't use. Match their register.
- Do not add interpretive commentary or therapeutic framing.
- Do not start every paragraph with "I". Vary sentence structure naturally.
- Target length: roughly 1 paragraph per 2-3 Q&A exchanges.
- End the chapter narrative naturally — no forced conclusions or life lessons unless ${ctx.project.whatToCall} stated them.

CHAPTER: ${ctx.chapterTitle}
SUBJECT NAME: ${ctx.project.whatToCall}

Here are the interview transcripts for this chapter:

${buildTranscripts(ctx)}`

function buildTranscripts(ctx: NarrativeContext): string {
  if (ctx.turns.length === 0) return '(no transcripts yet)'

  const buffer: string[] = []
  for (const turn of ctx.turns) {
    buffer.push(`Interviewer: ${turn.question}`)
    if (turn.answer) {
      buffer.push(`${ctx.project.whatToCall}: ${turn.answer}`)
    }
    buffer.push('')
  }
  return buffer.join('\n')
}

export async function composeChapterNarrative(ctx: NarrativeContext): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT(ctx) },
    { role: 'user', content: 'Please convert these transcripts into narrative prose.' },
  ]

  const out = await chatCompletion(messages, { temperature: 0.75, maxTokens: 4096 })
  return sanitizeManuscript(out)
}
