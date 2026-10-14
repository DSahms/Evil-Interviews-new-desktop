/**
 * Subject Engine — Service 1 (Subject side)
 *
 * CRITICAL FIX: Same as the interviewer — uses the chat API's NATIVE
 * message history format (alternating user/assistant messages). The
 * subject sees: the interviewer's questions as 'user' messages and
 * its own previous answers as 'assistant' messages. The LLM naturally
 * continues as the next assistant message = the next answer.
 *
 * Message format:
 *   system: "You ARE [character]..." (with context_block)
 *   user: (the interviewer's current question — the one to answer)
 *
 * For follow-up answers, the full conversation history is included:
 *   user: Q1 → assistant: A1 → user: Q2 → assistant: A2 → user: Q3 (current)
 *
 * The LLM generates A3 as an assistant message.
 */

import { chatCompletion, ChatMessage } from '../provider'
import { sanitizeAnswer } from '../sanitize'
import type { Project, Turn } from '@prisma/client'

export interface SubjectContext {
  project: Pick<Project, 'id' | 'characterName' | 'whatToCall' | 'corpusPath' | 'characterSummary'>
  chapterTitle: string
  chapterOrder: number
  question: string
  recentTurns: Turn[]
  chapterSummaries: { title: string; summary: string }[]
}

const SYSTEM_PROMPT = (ctx: SubjectContext): string => `You ARE ${ctx.project.characterName}. The interviewer calls you "${ctx.project.whatToCall}". You are being interviewed about your life and experience.

Stay in your voice throughout. Answer from your own perspective, in first person. You are not a narrator or a summarizer. You ARE the subject.
Distinguish what you remember from what you heard from what you don't know. "I don't know" is a legitimate answer. Do not invent facts.
You are not a villain narrating your villainy. You are a being with your own interior life. What humans call "evil" is, from your perspective, often something else.

${buildContextBlock(ctx)}

Respond with ONLY your answer. No reasoning, no meta-commentary, no role analysis. Just your words as ${ctx.project.whatToCall}. 150-400 words.`

function buildContextBlock(ctx: SubjectContext): string {
  const parts: string[] = []
  if (ctx.project.characterSummary) {
    parts.push(`## What is known about you:\n${ctx.project.characterSummary}`)
  }
  if (ctx.chapterSummaries.length > 0) {
    const summaries = ctx.chapterSummaries
      .filter((s) => s.summary.trim())
      .map((s) => `${s.title}: ${s.summary}`)
      .join('\n\n')
    if (summaries) {
      parts.push(`## What you have shared in previous chapters:\n${summaries}`)
    }
  }
  if (parts.length === 0) return `(This is the first conversation.)`
  return parts.join('\n\n')
}

export async function generateAnswer(ctx: SubjectContext): Promise<string> {
  // Build the message array using ALTERNATING user/assistant roles.
  // The interviewer's questions are 'user' messages (the interviewer speaking TO the subject).
  // The subject's previous answers are 'assistant' messages (the subject's own voice).
  // The LLM sees: "the interviewer asked Q1, I answered A1, they asked Q2, I answered A2,
  // they just asked Q3 — I need to answer as the subject."
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT(ctx) },
  ]

  // Add the last 4-6 turns as alternating user/assistant messages
  const recent = ctx.recentTurns.slice(-6)
  for (const turn of recent) {
    if (turn.answer) {
      messages.push({ role: 'user', content: turn.question })      // interviewer asked
      messages.push({ role: 'assistant', content: turn.answer })   // subject answered
    }
  }

  // Add the CURRENT question as the final user message
  // (the interviewer just asked this — the LLM needs to respond as the subject)
  messages.push({ role: 'user', content: ctx.question })

  const a = await chatCompletion(messages, { temperature: 0.7, maxTokens: 1000 })
  return sanitizeAnswer(a, ctx.project.characterName)
}
