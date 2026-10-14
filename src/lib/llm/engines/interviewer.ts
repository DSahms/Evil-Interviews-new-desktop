/**
 * Interviewer Engine — Service 1
 *
 * SEED QUESTIONS: The first question of each chapter is a hardcoded seed
 * question — no LLM call, zero risk of reasoning/leakage. The LLM only
 * generates Q2+ (follow-up questions), which is much easier because it
 * has conversation history (alternating user/assistant messages) to
 * work with.
 *
 * MESSAGE FORMAT: Uses the chat API's native message history format
 * (alternating user/assistant messages). The LLM sees a real conversation
 * and naturally continues it as the next assistant message.
 */

import { chatCompletion, ChatMessage } from '../provider'
import { sanitizeQuestion } from '../sanitize'
import { getSeedQuestion } from '@/lib/interview/chapters'
import type { Project, Turn } from '@prisma/client'

export interface InterviewerContext {
  project: Pick<Project, 'id' | 'characterName' | 'whatToCall' | 'interviewerBio' | 'corpusPath' | 'characterSummary'>
  chapterTitle: string
  chapterOrder: number
  recentTurns: Turn[]
  chapterSummaries: { title: string; summary: string }[]
}

const SYSTEM_PROMPT = (ctx: InterviewerContext): string => `You are a warm, patient interviewer helping someone tell their life story. You are sitting with ${ctx.project.whatToCall} on a quiet afternoon. There is no rush. You have all the time in the world.

Ask ONE question at a time. After each response, decide: go deeper on this thread, or move to something new. Trust your instinct.
When someone gives you surface-level facts, gently pull for the texture beneath.
Mirror the person's language and energy. You are a curious, empathetic listener.

Pull for sensory detail, emotional truth, specific memories. The specific over the general.
Never judge. Never rush. Never ask compound questions. Never break character.
Never explain what context you have or don't have.

${ctx.project.interviewerBio ? `\n${ctx.project.interviewerBio}\n` : ''}

CHAPTER: ${ctx.chapterTitle}

${buildContextBlock(ctx)}

Respond with ONLY the question. No preamble, no reasoning. Just the natural question. If the person just shared something emotional, you may acknowledge it briefly (one short sentence) before asking.`

function buildContextBlock(ctx: InterviewerContext): string {
  const parts: string[] = []
  if (ctx.project.characterSummary) {
    parts.push(`## What is known about ${ctx.project.whatToCall}:\n${ctx.project.characterSummary}`)
  }
  if (ctx.chapterSummaries.length > 0) {
    const summaries = ctx.chapterSummaries
      .filter((s) => s.summary.trim())
      .map((s) => `${s.title}: ${s.summary}`)
      .join('\n\n')
    if (summaries) {
      parts.push(`## What has been shared in previous chapters:\n${summaries}`)
    }
  }
  if (parts.length === 0) return `(This is the first conversation with ${ctx.project.whatToCall}.)`
  return parts.join('\n\n')
}

export async function generateQuestion(ctx: InterviewerContext): Promise<string> {
  // SEED QUESTION: If no prior turns in this chapter, use the hardcoded
  // seed question. No LLM call — zero risk of reasoning/leakage on Q1.
  const answeredTurns = ctx.recentTurns.filter((t) => t.answer)
  if (answeredTurns.length === 0) {
    return getSeedQuestion(ctx.chapterOrder)
  }

  // FOLLOW-UP QUESTION: Build the message array using alternating
  // user/assistant roles. The LLM sees the real conversation and
  // naturally generates the next question as an assistant message.
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT(ctx) },
  ]

  // Add the last 4-6 answered turns as alternating user/assistant messages.
  // The interviewer's questions are 'assistant' messages.
  // The subject's answers are 'user' messages.
  const recent = answeredTurns.slice(-6)
  for (const turn of recent) {
    messages.push({ role: 'assistant', content: turn.question })
    messages.push({ role: 'user', content: turn.answer })
  }
  // The last message is the subject's answer (user role).
  // The LLM naturally responds as the assistant = the next question.

  const q = await chatCompletion(messages, { temperature: 0.6, maxTokens: 600 })
  return sanitizeQuestion(q)
}
