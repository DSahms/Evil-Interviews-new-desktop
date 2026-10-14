/**
 * Output sanitizer — defense-in-depth.
 *
 * PRIMARY DEFENSE: The fill-in-the-blank prompt format. The user prompt ends
 * with a Q or A prefix marker so the LLM completes the content right after
 * the prefix. This forces direct output instead of chain-of-thought reasoning.
 *
 * SECONDARY DEFENSE (this file): If the LLM still generates meta-commentary
 * before or after the prefix marker, extract just the content after the
 * prefix. Also strip common leakage patterns as a final cleanup.
 *
 * The sanitizer is conservative — it only strips patterns that are
 * UNAMBIGUOUSLY leakage. It does not touch legitimate content.
 */

/**
 * Extract the content after a Q:/A: prefix marker at the START of a line.
 * This is the primary defense against chain-of-thought reasoning — if the
 * LLM generates reasoning before the prefix, we just take what comes after
 * the prefix.
 *
 * CRITICAL: Only matches at the START of a line (using ^ + m flag), NOT
 * mid-text. This prevents false matches like "question." at the end of
 * "Let's write a longer question." from truncating the entire output.
 *
 * If no line-start prefix is found, return the text as-is.
 */
function extractAfterPrefix(text: string): string {
  // Match **Q:** or Q: or **A:** or A: or Question: or Answer: at the
  // start of a line. Also consume ** after the colon (for **Q:** format).
  const prefixRe = /^(?:\*\*)?\s*(?:Q|Question|A|Answer)\s*(?:\*\*)?\s*[:.]\s*(?:\*\*)?\s*/gim
  const matches = [...text.matchAll(prefixRe)]
  if (matches.length === 0) return text
  // Take the LAST match — if the LLM wrote reasoning on earlier lines,
  // then "**Q:**" on a later line, then the actual question, we want
  // just the question.
  const lastMatch = matches[matches.length - 1]
  const after = text.slice(lastMatch.index! + lastMatch[0].length)
  return after.trim()
}

/**
 * Main sanitizer. Strips common leakage patterns from LLM output.
 */
export function sanitizeLLMOutput(text: string, characterName?: string): string {
  if (!text) return text

  // PRIMARY: Extract content after **Q:** or **A:** prefix if present.
  // This catches chain-of-thought reasoning before the prefix.
  let out = extractAfterPrefix(text)

  // --- Mid-text cleanup ---
  // Strip "Chapter N of 11" mentions
  out = out.replace(/\bchapter\s+\d+\s+of\s+\d+\b/gi, '')
  // Strip "Chapter N —" / "Chapter N:" prefixes
  out = out.replace(/\bchapter\s+\d+\s*[:—-]\s*/gi, '')
  // Strip "Question N:" mid-text
  out = out.replace(/\bQuestion\s+\d+\s*[:.]\s+/gi, '')
  // Strip markdown headers (## YOUR TASK, etc.)
  out = out.replace(/^#{1,6}\s+[^\n]*$/gim, '')
  // Strip word-count references
  out = out.replace(/\(?\s*(?:around|approximately|about|~)?\s*\d+\s*[-–]?\s*\d*\s+words?\s*\)?\.?/gi, '')

  // --- Prefix patterns (strip just the prefix, keep the rest) ---
  const prefixPatterns: RegExp[] = [
    /^(?:We\s+(?:need\s+to|should|want\s+to)\s+(?:ask|answer|respond|convey|express|craft|write|mention|expand))[^.\n]*[.!:]\s*/i,
    /^(?:I\s+(?:should|need\s+to|want\s+to|have\s+to)\s+(?:ask|answer|respond|convey|express|craft|write|mention|expand))[^.\n]*[.!:]\s*/i,
    /^(?:Let(?:'s| me)\s+(?:think|craft|write|consider|figure|work|ask|answer))[^.\n]*[.!:]\s*/i,
    /^(?:The\s+(?:question|answer|style|narrative|subject)\s+(?:should|is|must|will|might))[^.\n]*[.!:]\s*/i,
    /^(?:This\s+(?:question|response|answer|narrative)\s+(?:is|should|reflects?))[^.\n]*[.!:]\s*/i,
    /^(?:Following\s+from|Building\s+on|Based\s+on)[^.\n]*[.!:]\s*/i,
    /^(?:As\s+(?:the\s+)?(?:interviewer|subject|narrator|writer|biographer))[,]?\s*/i,
    /^(?:Staying\s+in\s+character|In\s+character)[,]?\s*/i,
    /^(?:Per\s+(?:your|my|the)\s+(?:instructions?|canon|established))[,]?\s*/i,
    /^(?:Draft|Note|Internal|Reasoning|Thinking|Thoughts?|Plan|Strategy|Approach)\s*:\s*/i,
  ]
  if (characterName) {
    const esc = characterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    prefixPatterns.push(
      new RegExp(`^As\\s+${esc},?\\s*`, 'i'),
      new RegExp(`^\\(?${esc}\\s+speaks?:\\s*\\)\\s*`, 'i'),
    )
  }

  // Apply prefix patterns in a loop until stable
  let changed = true
  let iterations = 0
  while (changed && iterations < 8) {
    changed = false
    iterations++
    for (const re of prefixPatterns) {
      const before = out
      out = out.replace(re, '')
      out = out.replace(new RegExp('\\n' + re.source, 'gi'), '\n')
      if (out !== before) changed = true
    }
  }

  // Collapse multiple blank lines
  out = out.replace(/\n{3,}/g, '\n\n')

  return out.trim()
}

/**
 * Extract the last complete quoted question from reasoning text.
 *
 * When the LLM does chain-of-thought reasoning (which reasoning models like
 * o1/o3/DeepSeek-R1 ALWAYS do), it drafts multiple candidate questions in
 * quotes before settling on one. The LAST complete quoted question is the
 * one the LLM chose.
 *
 * Example reasoning text:
 *   "So we might ask: 'What stories shaped you?' But we need origins.
 *    So maybe: 'Can you describe your earliest moments?' Let's ask:
 *    'What is the story behind your name?'"
 *
 * Extraction: "What is the story behind your name?"
 */
function extractLastQuotedQuestion(text: string): string | null {
  // Match text within double quotes (straight " or curly ") that ends with "?"
  // The text inside can contain single quotes (e.g., 'Jersey Devil5')
  const re = /["\u201c]([^"\u201d]+\?)["\u201d]/g
  const matches = [...text.matchAll(re)]
  if (matches.length > 0) {
    return matches[matches.length - 1][1].trim()
  }

  // Try single-quoted questions: 'text?' or 'text?'
  const re2 = /[\u2018']([^\u2019']+\?)[\u2019']/g
  const matches2 = [...text.matchAll(re2)]
  if (matches2.length > 0) {
    return matches2[matches2.length - 1][1].trim()
  }

  return null
}

/**
 * Extract the last sentence ending with "?" from reasoning text.
 * Fallback when no quoted question is found.
 */
function extractLastQuestion(text: string): string | null {
  // Match any text ending with "?" — take the last one
  const re = /[^.!?\n]*\?/g
  const matches = [...text.matchAll(re)]
  if (matches.length > 0) {
    let q = matches[matches.length - 1][0].trim()
    // Strip leading prefixes like "So: ", "Let's ask: ", "We should ask: "
    q = q.replace(/^(?:So|Let'?s ask|We should ask|We might ask|Maybe|Perhaps|I would ask|The question is)[:\s]*/i, '')
    return q.trim()
  }
  return null
}

/**
 * Sanitize a question.
 *
 * Three-layer defense:
 *   1. If the LLM output **Q:** prefix, extract after it.
 *   2. If the LLM did chain-of-thought reasoning (no prefix), extract the
 *      last complete quoted question from the reasoning.
 *   3. If no quoted question, extract the last sentence ending with "?".
 *   4. Fall back to the general sanitizer.
 */
export function sanitizeQuestion(text: string): string {
  // Layer 1: Try prefix extraction (if LLM followed the **Q:** format)
  const afterPrefix = sanitizeLLMOutput(text)

  // Check if the result looks clean (short, ends with "?", no reasoning words)
  const looksClean = afterPrefix.length < 300 &&
    afterPrefix.endsWith('?') &&
    !/^(?:We\s+|I\s+|Let'?s|The\s+question|So\s+|But\s+|This\s+)/i.test(afterPrefix)

  if (looksClean) return afterPrefix.trim()

  // Layer 2: Try extracting the last quoted question from reasoning
  const quoted = extractLastQuotedQuestion(text)
  if (quoted && quoted.length > 10) {
    return quoted
  }

  // Layer 3: Try extracting the last sentence ending with "?"
  const lastQ = extractLastQuestion(text)
  if (lastQ && lastQ.length > 10) {
    return lastQ
  }

  // Layer 4: Fall back to the general sanitizer
  return afterPrefix.trim()
}

/**
 * Sanitize an answer. Extract content after **A:** if present, then
 * apply the general sanitizer.
 */
export function sanitizeAnswer(text: string, characterName?: string): string {
  return sanitizeLLMOutput(text, characterName).trim()
}

/**
 * Sanitize manuscript/narrative prose. Strip markdown headers and preamble.
 */
export function sanitizeManuscript(text: string): string {
  let out = text
  // Strip all markdown headers (composition output should be prose only)
  out = out.replace(/^#{1,6}\s+[^\n]*$/gim, '')
  // Strip common preamble patterns
  out = out.replace(/^(?:Continuing|New\s+paragraphs?|The\s+(?:new\s+)?prose)\s*[:]?\s*/im, '')
  // Apply general sanitizer
  out = sanitizeLLMOutput(out)
  return out.trim()
}
