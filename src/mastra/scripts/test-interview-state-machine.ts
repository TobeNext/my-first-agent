/**
 * E2E validation for the interview state machine flow.
 *
 * Usage: npx tsx src/mastra/scripts/test-interview-state-machine.ts
 */
/// <reference types="node" />

const BASE_URL = process.env.MASTRA_URL || 'http://localhost:4111';
const AGENT_ID = 'interview-agent';

interface GenerateResponse {
  text: string;
}

function createThreadId(label: string): string {
  return `state-machine-${label}-${Date.now()}`;
}

function buildKickoffMessage(options: {
  readonly direction: string;
  readonly reviewIncorrectOrMissingPoints?: boolean;
  readonly skipProfessionalSkillsRound?: boolean;
  readonly skipProjectExperienceRound?: boolean;
  readonly enableFlowTestMode?: boolean;
}): string {
  return [
    'The candidate has uploaded the following markdown resume.',
    'You must parse it with resumeParserTool before starting the interview.',
    'The interview must have two stages in order: 专业技能阶段 first, 项目经验阶段 second.',
    'The candidate has already completed a structured setup step before the interview starts.',
    `Selected interview direction: ${options.direction}`,
    'Direction source: preset',
    'System settings:',
    `- Review incorrect or missing points after each completed question: ${options.reviewIncorrectOrMissingPoints ?? true ? 'enabled' : 'disabled'}`,
    `- Skip professional-skills round: ${options.skipProfessionalSkillsRound ? 'yes' : 'no'}`,
    `- Skip project-experience round: ${options.skipProjectExperienceRound ? 'yes' : 'no'}`,
    `- Flow test mode: ${options.enableFlowTestMode ? 'enabled' : 'disabled'}`,
    'Use clear round headers so the first round and second round are visually distinct.',
    '',
    'Resume Markdown:',
    '# 简历',
    '### 专业技能',
    '- TypeScript, Node.js, NestJS, Vue 3, AI Agent, RAG, 向量检索',
    '- LLM 应用工程化、Prompt 设计、Observability、测试自动化',
    '',
    '### 项目经历',
    '- 负责一个 AI Interview 平台，从前端到 BFF 再到 Mastra runtime 的完整链路设计与交付。',
    '- 为 RAG 检索链路增加质量评估和回放调试能力。',
  ].join('\n');
}

async function chat(threadId: string, message: string, step: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/agents/${AGENT_ID}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: message }],
      memory: {
        thread: threadId,
        resource: `test-resource-${threadId}`,
      },
      maxSteps: 5,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`[${step}] API ${response.status}: ${raw}`);
  }

  const parsed = JSON.parse(raw) as GenerateResponse;
  const text = parsed.text || '(empty response)';
  console.log(`\n[${step}]\n${text.slice(0, 1200)}`);
  return text;
}

function assertContains(text: string, expected: string, label: string): void {
  if (!text.includes(expected)) {
    throw new Error(`${label}: expected response to include "${expected}".`);
  }
}

function looksLikeRoundAnnouncement(text: string): boolean {
  return (
    text.includes('专业技能') ||
    text.includes('Professional Skills') ||
    text.includes('【第一轮') ||
    text.includes('第一阶段')
  );
}

function looksLikeSetupPreamble(text: string): boolean {
  const preambleSignals = [
    'I\'ll parse the resume first',
    'Now I\'ll get interview questions',
    'proceed with the interview setup',
    'extract the professional skills',
    '先解析简历',
    '开始准备面试',
    '获取面试问题',
  ];

  return preambleSignals.some((signal) => text.includes(signal));
}

function looksLikeRedirectToQuestion(text: string): boolean {
  const redirectSignals = [
    '当前问题',
    '回到刚才的问题',
    '让我们回到刚才的问题',
    '回到这个问题',
    '让我们回到',
    'Please answer this question directly',
    'Please continue here',
    'Let me pull us back',
    'Let us return to the question',
  ];

  const restatedRoundQuestion = text.includes('【第一轮：专业技能面试】') && /[？?]/.test(text);

  return redirectSignals.some((signal) => text.includes(signal)) || restatedRoundQuestion;
}

function looksLikeFollowUpOrNextQuestion(text: string): boolean {
  const followUpSignals = [
    '请继续',
    '请结合',
    '请详细说明',
    'trade-offs',
    'go one level deeper',
    '请说明',
    '问题',
  ];

  return followUpSignals.some((signal) => text.includes(signal));
}

function looksLikeWrapUpReport(text: string): boolean {
  return (
    text.includes('Interview Evaluation Report') ||
    text.includes('面试评估报告') ||
    text.includes('综合评分') ||
    text.includes('总体评价')
  );
}

function looksLikeDeferredWrapUp(text: string): boolean {
  return (
    text.includes('当前还有') ||
    text.includes('我会在所有问题结束后再给出面试报告') ||
    text.includes('There are still') ||
    text.includes('I will give you the interview report only after all questions are finished')
  );
}

async function startInterviewAndGetRound(threadId: string, kickoffMessage: string, step: string): Promise<string> {
  const firstReply = await chat(threadId, kickoffMessage, step);
  if (looksLikeRoundAnnouncement(firstReply)) {
    return firstReply;
  }

  if (!looksLikeSetupPreamble(firstReply)) {
    throw new Error(`${step}: expected either the active round or a setup preamble.`);
  }

  const secondReply = await chat(threadId, '请继续并正式开始面试，直接给出当前轮次和第一个问题。', `${step}-CONTINUE`);
  if (!looksLikeRoundAnnouncement(secondReply)) {
    throw new Error(`${step}: expected the follow-up reply to announce the active round.`);
  }

  return secondReply;
}

async function runInitializationScenario(): Promise<void> {
  const threadId = createThreadId('init');
  const reply = await startInterviewAndGetRound(
    threadId,
    buildKickoffMessage({ direction: 'AI Agent Engineer' }),
    'INIT',
  );

  if (!looksLikeRoundAnnouncement(reply)) {
    throw new Error('Initialization scenario: expected the first reply to announce the active round.');
  }
}

async function runDetourScenario(): Promise<void> {
  const threadId = createThreadId('detour');
  await startInterviewAndGetRound(
    threadId,
    buildKickoffMessage({ direction: 'AI Agent Engineer', reviewIncorrectOrMissingPoints: false }),
    'DETOUR-INIT',
  );

  const detour1 = await chat(threadId, '先不回答这题，我想问你今天过得怎么样？', 'DETOUR-1');
  if (!looksLikeRedirectToQuestion(detour1)) {
    throw new Error('Detour scenario first redirect: expected the agent to redirect back to the active question.');
  }

  const detour2 = await chat(threadId, '那你先介绍一下你的评分规则。', 'DETOUR-2');
  if (!looksLikeRedirectToQuestion(detour2)) {
    throw new Error('Detour scenario second redirect: expected the agent to pull the candidate back to the active question.');
  }

  const answer = await chat(
    threadId,
    '我会先从Agent的目标、可用工具、状态管理和失败恢复这四个维度来设计整体架构。状态层需要显式区分当前节点、追问链路以及偏题恢复计数，否则流程很容易漂移。',
    'DETOUR-ANSWER',
  );

  if (!looksLikeFollowUpOrNextQuestion(answer)) {
    throw new Error('Detour scenario answer: expected a follow-up or next-question prompt after the candidate returned to the topic.');
  }
}

async function runWrapUpScenario(): Promise<void> {
  const threadId = createThreadId('wrapup');
  await startInterviewAndGetRound(
    threadId,
    buildKickoffMessage({ direction: 'AI Agent Engineer' }),
    'WRAPUP-INIT',
  );

  const report = await chat(threadId, '差不多了，请结束面试并给我报告。', 'WRAPUP-END');
  if (!looksLikeDeferredWrapUp(report)) {
    throw new Error('Wrap-up scenario report: expected the agent to defer the report until all questions are finished.');
  }
}

async function runFlowTestSkipScenario(): Promise<void> {
  const threadId = createThreadId('flow-test');
  await startInterviewAndGetRound(
    threadId,
    buildKickoffMessage({ direction: 'AI Agent Engineer', enableFlowTestMode: true }),
    'FLOW-TEST-INIT',
  );

  const followUp = await chat(threadId, '[FLOW_TEST_SKIP]', 'FLOW-TEST-SKIP-1');
  if (!looksLikeFollowUpOrNextQuestion(followUp)) {
    throw new Error('Flow test scenario first skip: expected a follow-up or next question.');
  }

  const nextTurn = await chat(threadId, '[FLOW_TEST_SKIP]', 'FLOW-TEST-SKIP-2');
  if (!looksLikeFollowUpOrNextQuestion(nextTurn)) {
    throw new Error('Flow test scenario second skip: expected the interview to keep advancing.');
  }
}

async function main(): Promise<void> {
  console.log('Running interview state machine E2E scenarios...');

  await runInitializationScenario();
  await runDetourScenario();
  await runWrapUpScenario();
  await runFlowTestSkipScenario();

  console.log('\nAll interview state machine scenarios passed.');
}

main().catch((error) => {
  console.error('\nInterview state machine E2E failed:', error);
  process.exit(1);
});