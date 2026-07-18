import { z } from 'zod'

import type { ToolDefinition } from './tool-types'
import type { Question, QuestionAnswerBundle } from '../questions/question-types'

const ASK_USER_QUESTION_TOOL_ID = 'askUserQuestion'
const ASK_USER_QUESTION_CHIP_WIDTH = 12

const ASK_USER_QUESTION_TOOL_PROMPT = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Ask only when the answer is not discoverable from the workspace or available tools and a reasonable assumption would be risky.
- Users will always be able to select "Other" to provide custom text input.
- Use multiSelect: true to allow multiple answers to be selected for a question.
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label.
- Optional \`preview\` on options renders a markdown box next to the options; use it only for concrete artifacts the user needs to visually compare (ASCII mockups, code snippets, diagram variations, configuration examples). Previews are ignored for multiSelect questions.`

const questionOptionSchema = z
  .object({
    label: z
      .string()
      .min(1)
      .describe('Display text for this option. Concise (1-5 words), clearly describes the choice.'),
    description: z
      .string()
      .describe('Explanation of what the option means or what happens if chosen. Include trade-offs.'),
    preview: z
      .string()
      .optional()
      .describe('Optional markdown preview shown when this option is focused. Use for mockups or snippets.'),
  })
  .strict()

const questionSchema = z
  .object({
    question: z
      .string()
      .min(1)
      .describe('The complete question to ask. Clear, specific, ends with a question mark.'),
    header: z
      .string()
      .min(1)
      .max(ASK_USER_QUESTION_CHIP_WIDTH)
      .describe(`Short label shown as a chip (max ${ASK_USER_QUESTION_CHIP_WIDTH} chars). Examples: "Auth", "Library".`),
    options: z
      .array(questionOptionSchema)
      .min(2)
      .max(4)
      .describe('The available choices. Must have 2-4 options. Do not include an "Other" option; the UI adds one.'),
    multiSelect: z
      .boolean()
      .optional()
      .default(false)
      .describe('When true, the user may select multiple options.'),
  })
  .strict()

const askUserQuestionSchema = z
  .object({
    questions: z.array(questionSchema).min(1).max(4).describe('Questions to ask the user (1-4 questions).'),
  })
  .strict()
  .superRefine((data, ctx) => {
    const questionTexts = data.questions.map((q) => q.question)
    if (questionTexts.length !== new Set(questionTexts).size) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Question texts must be unique.' })
    }
    for (const q of data.questions) {
      const labels = q.options.map((opt) => opt.label)
      if (labels.length !== new Set(labels).size) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Option labels must be unique within question "${q.question}".`,
        })
      }
    }
  })

type AskUserQuestionInput = z.infer<typeof askUserQuestionSchema>
export type AskUserQuestionOutput = QuestionAnswerBundle & {
  questions: Question[]
}

function normalizeQuestions(input: AskUserQuestionInput): Question[] {
  return input.questions.map((q) => ({
    question: q.question,
    header: q.header,
    options: q.options.map((opt) => ({
      label: opt.label,
      description: opt.description,
      ...(opt.preview !== undefined ? { preview: opt.preview } : {}),
    })),
    multiSelect: q.multiSelect ?? false,
  }))
}

export const askUserQuestionTool: ToolDefinition<typeof askUserQuestionSchema, AskUserQuestionOutput> = {
  id: ASK_USER_QUESTION_TOOL_ID,
  displayName: 'Ask User Question',
  description:
    'Ask the user 1-4 multiple-choice questions to resolve blocking ambiguity, preferences, or implementation decisions. ' +
    ASK_USER_QUESTION_TOOL_PROMPT,
  inputSchema: askUserQuestionSchema,
  shouldPersistLargeResult: false,
  summarize: (result) => {
    const pairs = Object.entries(result.answers)
      .map(([question, answer]) => `${question} → ${answer}`)
      .join(' | ')
    return pairs ? `User answers: ${pairs}` : 'User answered.'
  },
  execute: async (input, context) => {
    if (!context.questionEngine) {
      throw new Error('Question engine is not configured; AskUserQuestion requires an interactive session.')
    }

    const questions = normalizeQuestions(input)
    const bundle = await context.questionEngine.ask(questions, { signal: context.signal })
    return {
      questions,
      answers: bundle.answers,
      ...(bundle.annotations ? { annotations: bundle.annotations } : {}),
    }
  },
}
