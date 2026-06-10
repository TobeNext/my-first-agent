import { Agent } from '@mastra/core/agent';
import { z } from 'zod';

import { glmAirModel } from '../lib/zhipu-model';

export const ANSWER_EVALUATION_PROMPT_VERSION = 'answer-evaluation-v1';
export const ANSWER_EVALUATION_MODEL_NAME = 'zhipuai/glm-4.5-air';

export const rawAnswerEvaluationOutputSchema = z.object({
  classification: z.enum([
    'direct-answer',
    'partial-answer',
    'deep-answer',
    'off-topic',
    'clarification-request',
    'skip-request',
    'stop-request',
    'meta-question',
  ]),
  score: z.object({
    relevance: z.number().min(0).max(10),
    accuracy: z.number().min(0).max(10),
    depth: z.number().min(0).max(10),
    specificity: z.number().min(0).max(10),
    clarity: z.number().min(0).max(10),
  }),
  strengths: z.array(z.string()),
  missingPoints: z.array(z.string()),
  incorrectPoints: z.array(z.string()),
  shouldAskFollowUp: z.boolean(),
  followUpFocus: z.array(z.string()),
});

export type RawAnswerEvaluationOutput = z.infer<typeof rawAnswerEvaluationOutputSchema>;

const SYSTEM_PROMPT = `You are an answer evaluation subagent for a mock interview.
Return JSON only.
Do not reveal the reference answer.
Use the reference answer as guidance, not as a script.
Equivalent wording counts as covered.
Do not require exact phrasing.
Do not punish a candidate for giving a valid alternative explanation.
Only mark incorrectPoints when the candidate says something technically wrong.
Mark missingPoints for important gaps that matter for the asked question.
Score each dimension from 0 to 10:
- relevance: answer addresses the asked question and stays on topic.
- accuracy: technical correctness compared with reference answer and accepted equivalents.
- depth: mechanisms, trade-offs, edge cases, reasoning.
- specificity: concrete implementation details, project evidence, constraints, metrics.
- clarity: structure, readability, coherence.
Never include the full reference answer in strengths, missingPoints, incorrectPoints, or followUpFocus.`;

export const answerEvaluationAgent = new Agent({
  id: 'answer-evaluation-agent',
  name: 'Answer Evaluation Agent',
  instructions: SYSTEM_PROMPT,
  model: glmAirModel,
});
