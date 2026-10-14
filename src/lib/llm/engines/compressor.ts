/**
 * Context Compressor — Service 2 (Long-Term Memory)
 *
 * Based on the working app's ContextCompressor.dart.
 *
 * Summarizes interview sessions into 150-250 word natural-prose summaries
 * that replace the raw transcript in future interview prompts. This is the
 * "secret sauce" — the interview prompt never grows because it always uses
 * the compressed summary instead of the full transcript.
 *
 * Two functions:
 *   - summarizeSession: summarizes one chapter's turns
 *   - summarizeCorpus: summarizes the character's corpus into a character
 *     summary (generated once at project creation)
 */

import { chatCompletion, ChatMessage } from '../provider'
import { sanitizeLLMOutput } from '../sanitize'
import type { Turn } from '@prisma/client'

const SUMMARIZE_SESSION_SYSTEM = `You are summarizing an interview session for an autobiography project. Your summary will be used as context for future interview sessions, so capture what matters most for continuing the conversation naturally.

Include:
- Key facts shared (names, dates, places, events)
- Emotional themes and tone of the conversation
- Specific vivid details the person shared (sensory, physical, relational)
- Any topics the person seemed reluctant to discuss or that felt unfinished
- Names and relationships mentioned
- Anything that connects to other life chapters

Do NOT include:
- The interviewer's questions (just capture the substance of answers)
- Generic observations
- Therapeutic interpretations

Write in third person past tense. Target length: 150-250 words.
Write as if briefing a friend who will continue the conversation tomorrow.`

const SUMMARIZE_CORPUS_SYSTEM = `You are summarizing background research about a subject for an interview project. Your summary will be used as context for the interviewer and the subject, so they can reference it naturally.

Include:
- Key facts about the subject (identity, nature, type, known history)
- Key events, dates, and locations associated with the subject
- Descriptive details that have been reported (appearance, behavior, sounds)
- Relationships or connections to places, people, or events
- Any contradictions or unresolved questions in the record

Do NOT include:
- Source analysis or methodology
- Copy-chain analysis
- Generic observations

Write in third person. Target length: 150-250 words.
Write as if briefing a friend who will interview this subject tomorrow.`

/**
 * Summarize a chapter's turns into a 150-250 word compressed summary.
 * Called when advancing chapters (or on-demand).
 */
export async function summarizeSession(
  whatToCall: string,
  turns: Turn[]
): Promise<string> {
  if (turns.length === 0) return ''

  const conversationText = turns
    .map((t) => {
      const role = t.answer ? `${whatToCall}` : 'Interviewer'
      return `${role}: ${t.question}\n${t.answer ? `${whatToCall}: ${t.answer}` : ''}`
    })
    .join('\n\n')

  const userMessage = `The subject being interviewed is named ${whatToCall}. Use their name in the summary, not "the subject" or "the person".

Here is a conversation from an interview session:

${conversationText}

Please summarize this conversation according to the guidelines provided.`

  const messages: ChatMessage[] = [
    { role: 'system', content: SUMMARIZE_SESSION_SYSTEM },
    { role: 'user', content: userMessage },
  ]

  const summary = await chatCompletion(messages, { temperature: 0.3, maxTokens: 350 })
  return sanitizeLLMOutput(summary).trim()
}

/**
 * Summarize the character's corpus into a 150-250 word character summary.
 * Called once at project creation. Stored in project.characterSummary.
 */
export async function summarizeCorpus(
  characterName: string,
  whatToCall: string,
  corpusMd: string
): Promise<string> {
  if (!corpusMd.trim()) return ''

  const userMessage = `The subject is ${characterName}, referred to as "${whatToCall}". Use this name in the summary.

Here is background research about this subject:

${corpusMd.slice(0, 12000)}

Please summarize this background research according to the guidelines provided.`

  const messages: ChatMessage[] = [
    { role: 'system', content: SUMMARIZE_CORPUS_SYSTEM },
    { role: 'user', content: userMessage },
  ]

  const summary = await chatCompletion(messages, { temperature: 0.3, maxTokens: 350 })
  return sanitizeLLMOutput(summary).trim()
}
