/**
 * Logic-level validation for the interview state machine.
 *
 * Usage: npx tsx src/mastra/scripts/test-interview-state-machine-logic.ts
 */

import { applyUserReply, initializeInterviewSession } from '../lib/interview-state-machine';
import { recoverMissingInterviewSession } from '../lib/interview-kickoff-recovery';
import { planProfessionalQuestionQueries } from '../lib/interview-question-planner';
import type { InterviewSessionState } from '../lib/interview-state-machine-schema';
import { buildInterviewStartRequest } from '../../../bff/src/modules/agent/interview-start-contract';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function createInitialState(): InterviewSessionState {
  return initializeInterviewSession({
    threadId: `logic-test-${Date.now()}`,
    rawKickoffMessage: [
      'Selected interview direction: AI Agent Engineer',
      'Direction source: preset',
      'System settings:',
      '- Review incorrect or missing points after each completed question: enabled',
      '- Skip professional-skills round: no',
      '- Skip project-experience round: no',
      '- Professional question count: 6',
      '- Project question count: 2',
      '',
      'Resume Markdown:',
      '### 专业技能',
      '- TypeScript, AI Agent, RAG, Prompt Engineering',
      '',
      '### 项目经历',
      '- 负责 AI 面试系统设计与交付。',
    ].join('\n'),
    professionalSkills: 'TypeScript\nAI Agent\nRAG\nPrompt Engineering',
    projectExperience: '负责 AI 面试系统设计与交付。',
    jobDescription: '',
    professionalQuestions: [
      {
        id: 'q-1',
        text: '请你说明 Agent 系统中状态机和工具调用之间的关系。',
        score: 0.9,
      },
      {
        id: 'q-2',
        text: '你会如何设计 RAG 检索链路的质量评估机制？',
        score: 0.8,
      },
    ],
    projectQuestions: [
      {
        id: 'p-1',
        text: '请介绍一个你负责过的 AI 应用项目。',
        score: 0.7,
      },
    ],
  });
}

function runInitializationAssertions(): InterviewSessionState {
  const state = createInitialState();
  assert(state.phase === 'professional-skills-round', 'Expected initialization to enter the professional-skills round.');
  assert(state.rounds[0]?.plannedNodeCount === 6, 'Expected the professional round to expand to 6 nodes.');
  assert(state.rounds[0]?.nodes[0]?.status === 'awaiting-main-answer', 'Expected the first professional node to be active.');
  return state;
}

function runQuestionCountAssertions(): void {
  const state = initializeInterviewSession({
    threadId: `logic-test-question-count-${Date.now()}`,
    rawKickoffMessage: [
      'Selected interview direction: AI Agent Engineer',
      'Direction source: preset',
      'System settings:',
      '- Review incorrect or missing points after each completed question: enabled',
      '- Skip professional-skills round: no',
      '- Skip project-experience round: no',
      '- Flow test mode: disabled',
      '- Professional question count: 3',
      '- Project question count: 2',
      '',
      'Resume Markdown:',
      '### 专业技能',
      '- TypeScript, AI Agent, RAG, Prompt Engineering',
      '',
      '### 项目经历',
      '- 负责 AI 面试系统设计与交付。',
    ].join('\n'),
    professionalSkills: 'TypeScript\nAI Agent\nRAG\nPrompt Engineering',
    projectExperience: '负责 AI 面试系统设计与交付。',
    jobDescription: '',
    professionalQuestions: [
      { id: 'q-1', text: '问题 1', score: 0.9 },
      { id: 'q-2', text: '问题 2', score: 0.8 },
      { id: 'q-3', text: '问题 3', score: 0.7 },
    ],
    projectQuestions: [
      { id: 'p-1', text: '项目问题 1', score: 0.7 },
      { id: 'p-2', text: '项目问题 2', score: 0.6 },
    ],
  });

  assert(state.rounds[0]?.plannedNodeCount === 3, 'Expected kickoff to preserve the configured professional question count.');
  assert(state.rounds[1]?.plannedNodeCount === 2, 'Expected kickoff to preserve the configured project question count.');
}

function runPerSkillDefaultAssertions(): void {
  const state = initializeInterviewSession({
    threadId: `logic-test-per-skill-default-${Date.now()}`,
    rawKickoffMessage: [
      'Selected interview direction: AI Agent Engineer',
      'Direction source: preset',
      'System settings:',
      '- Review incorrect or missing points after each completed question: enabled',
      '- Skip professional-skills round: no',
      '- Skip project-experience round: no',
      '- Professional question mode: per-skill-default',
      '- Professional question count: 6',
      '- Project question count: 2',
      '',
      'Resume Markdown:',
      '### 专业技能',
      '- 熟练掌握 TypeScript / C# ，具备 Java 工程开发能力。',
      '- 熟悉 LangChain、Mastra 等框架，具备 Agent 编排经验。',
      '',
      '### 项目经历',
      '- 负责 AI 面试系统设计与交付。',
    ].join('\n'),
    professionalSkills: [
      '- 熟练掌握 TypeScript / C# ，具备 Java 工程开发能力。',
      '- 熟悉 LangChain、Mastra 等框架，具备 Agent 编排经验。',
    ].join('\n'),
    projectExperience: '- 负责 AI 面试系统设计与交付。',
    jobDescription: '',
    professionalQuestions: [
      { id: 'q-1', text: '请说明你如何设计一个可维护的 TypeScript Agent 系统。', score: 0.9 },
      { id: 'q-2', text: '请说明你如何在 Mastra 中组织 Agent 编排与状态管理。', score: 0.8 },
      { id: 'q-3', text: '这道题不应被纳入默认模式。', score: 0.7 },
    ],
    projectQuestions: [{ id: 'p-1', text: '请介绍一个你负责过的 AI 应用项目。', score: 0.7 }],
  });

  assert(state.rounds[0]?.plannedNodeCount === 2, 'Expected per-skill-default mode to clamp the professional round to the skill group count.');
  assert(state.rounds[0]?.nodes.length === 2, 'Expected each professional skill group to produce at most one planned main question.');
}

function runProfessionalQuestionPlanningAssertions(): void {
  const customPlan = planProfessionalQuestionQueries({
    mode: 'custom-count',
    professionalSkills: ['TypeScript', 'AI Agent', 'RAG'],
    desiredQuestionCount: 5,
  });

  assert(customPlan.length === 5, 'Expected planner to return the full desired professional question count.');

  const skillFocusPlans = customPlan.filter((plan) => plan.kind === 'skill-focus');
  assert(skillFocusPlans.length === 3, 'Expected custom planning to use each skill at most once before adding overflow plans.');
  assert(
    new Set(skillFocusPlans.map((plan) => plan.primarySkill)).size === 3,
    'Expected custom planning to avoid repeating the same primary skill.',
  );
  assert(
    customPlan.slice(3).every((plan) => plan.kind !== 'skill-focus'),
    'Expected overflow plans to switch to cross-skill or broad scenarios instead of repeating a skill.',
  );

  const singleSkillOverflowPlan = planProfessionalQuestionQueries({
    mode: 'custom-count',
    professionalSkills: ['TypeScript'],
    desiredQuestionCount: 3,
  });

  assert(singleSkillOverflowPlan[0]?.kind === 'skill-focus', 'Expected the first slot to still cover the only available skill.');
  assert(
    singleSkillOverflowPlan.slice(1).every((plan) => plan.kind === 'broad-professional-scenario'),
    'Expected single-skill overflow to fall back to broader scenario questions instead of repeating the same skill.',
  );
}

function runRecoveryAssertions(): void {
  const recoveredKickoffState = recoverMissingInterviewSession({
    threadId: `recovery-kickoff-${Date.now()}`,
    rawKickoffMessage: [
      'Selected interview direction: AI Agent Engineer',
      'Direction source: preset',
      'System settings:',
      '- Review incorrect or missing points after each completed question: enabled',
      '- Skip professional-skills round: no',
      '- Skip project-experience round: no',
      '- Professional question count: 6',
      '- Project question count: 2',
      '',
      'Resume Markdown:',
      '### 专业技能',
      '- TypeScript, RAG, Agent Workflow',
      '',
      '### 项目经历',
      '- 负责 AI 面试系统的状态机设计与交付。',
    ].join('\n'),
  });

  assert(recoveredKickoffState.phase === 'professional-skills-round', 'Expected recovery to rebuild the opening round when kickoff payload is present.');
  assert(
    recoveredKickoffState.resumeContext.professionalSkills.includes('TypeScript'),
    'Expected recovery to extract professional skills from kickoff resume markdown.',
  );
  assert(
    recoveredKickoffState.resumeContext.projectExperience.includes('状态机设计'),
    'Expected recovery to extract project experience from kickoff resume markdown.',
  );
  assert(
    recoveredKickoffState.resumeContext.jobDescription === '',
    'Expected recovery to default the job description context to an empty string when none is provided.',
  );

  const recoveredWithJobDescription = recoverMissingInterviewSession({
    threadId: `recovery-job-description-${Date.now()}`,
    rawKickoffMessage: [
      'Selected interview direction: AI Agent Engineer',
      'Direction source: preset',
      'Resume Markdown:',
      '### 专业技能',
      '- TypeScript',
      '',
      'Job Description Markdown:',
      '### 岗位职责',
      '- 负责 AI Agent 平台架构设计',
    ].join('\n'),
  });

  assert(
    recoveredWithJobDescription.resumeContext.jobDescription.includes('AI Agent 平台架构设计'),
    'Expected recovery to retain the job description context for follow-up generation.',
  );

  const recoveredStructuredKickoffState = recoverMissingInterviewSession({
    threadId: `recovery-structured-${Date.now()}`,
    rawKickoffMessage: JSON.stringify(
      buildInterviewStartRequest({
        threadId: 'structured-thread',
        resumeMarkdown: [
          '### 专业技能',
          '- TypeScript',
          '- Mastra',
          '',
          '### 项目经历',
          '- 负责 AI 面试系统的状态机改造。',
        ].join('\n'),
        jobDescriptionMarkdown: '### 岗位职责\n- 负责 AI Agent 平台架构设计',
        settings: {
          reviewIncorrectOrMissingPoints: true,
          skipProfessionalSkillsRound: false,
          skipProjectExperienceRound: false,
          enableFlowTestMode: false,
          professionalQuestionMode: 'per-skill-default',
          professionalQuestionCount: 2,
          projectQuestionCount: 2,
        },
        resumeSections: {
          professionalSkills: '- TypeScript\n- Mastra',
          projectExperience: '- 负责 AI 面试系统的状态机改造。',
        },
      }),
    ),
  });

  assert(
    recoveredStructuredKickoffState.phase === 'professional-skills-round',
    'Expected the structured startup payload to initialize the opening round successfully.',
  );
  assert(
    recoveredStructuredKickoffState.rounds[0]?.plannedNodeCount === 2,
    'Expected the structured startup payload to preserve the requested professional question count.',
  );
  assert(
    recoveredStructuredKickoffState.resumeContext.professionalSkills.includes('Mastra'),
    'Expected the structured startup payload to reuse the provided resume sections.',
  );
  assert(
    recoveredStructuredKickoffState.resumeContext.jobDescription.includes('AI Agent 平台架构设计'),
    'Expected the structured startup payload to preserve the uploaded job description context.',
  );

  const recoveredGenericState = recoverMissingInterviewSession({
    threadId: `recovery-generic-${Date.now()}`,
    rawKickoffMessage: '我想练习一个 AI Agent Engineer 的技术面试，请直接开始。',
  });

  assert(recoveredGenericState.phase === 'professional-skills-round', 'Expected unstructured first-turn recovery to start the interview instead of failing.');
  assert(
    recoveredGenericState.rounds[0]?.plannedNodeCount === 6,
    'Expected generic recovery to still create the professional-skills round structure.',
  );
}

function runDetourAssertions(state: InterviewSessionState): InterviewSessionState {
  const detourResult = applyUserReply({
    state,
    userMessage: '我先不回答这题，我想先聊聊别的。',
    evaluation: {
      classification: 'off-topic',
      score: null,
      strengths: [],
      missingPoints: [],
      incorrectPoints: [],
      recommendedIntent: 'depth',
      followUpFocus: [],
      detourReply: '我先把当前问题收回来。请直接回答这道题：\n请你说明 Agent 系统中状态机和工具调用之间的关系。',
      clarificationReply: null,
      shouldCompleteNode: false,
      earlyCompletionReason: null,
    },
  });

  const activeRound = detourResult.state.rounds.find((round) => round.id === detourResult.state.activeRoundId);
  const activeNode = activeRound?.nodes.find((node) => node.id === activeRound.activeNodeId);

  assert(activeNode?.detourResponseCount === 1, 'Expected detour count to increase after an off-topic reply.');
  assert(detourResult.assistantReply.includes('当前问题'), 'Expected detour reply to redirect back to the active question.');
  return detourResult.state;
}

function runFollowUpAssertions(state: InterviewSessionState): InterviewSessionState {
  const followUpResult = applyUserReply({
    state,
    userMessage: '我会把状态机作为流程真相来源，并通过工具来驱动节点推进和偏题恢复。',
    evaluation: {
      classification: 'partial-answer',
      score: {
        relevance: 8,
        accuracy: 7,
        depth: 6,
        specificity: 6,
        clarity: 7,
        weightedTotal: 6.95,
      },
      strengths: ['回答和题目相关'],
      missingPoints: ['还没有解释状态持久化方式'],
      incorrectPoints: [],
      recommendedIntent: 'depth',
      followUpFocus: ['状态持久化方式', '非法状态转移保护'],
      followUpQuestion: '你提到用状态机驱动节点推进。请继续围绕当前这道题，具体说明状态是如何持久化的，以及你如何防止非法状态转移？',
      detourReply: null,
      clarificationReply: null,
      shouldCompleteNode: false,
      earlyCompletionReason: null,
    },
  });

  const activeRound = followUpResult.state.rounds.find((round) => round.id === followUpResult.state.activeRoundId);
  const activeNode = activeRound?.nodes.find((node) => node.id === activeRound.activeNodeId);
  const firstFollowUpQuestion = activeNode?.followUps.find((followUp) => followUp.status === 'asked')?.question ?? '';

  assert(activeNode?.status === 'awaiting-follow-up-answer', 'Expected a partial answer to trigger a follow-up question.');
  assert(activeNode?.followUpCount === 1, 'Expected follow-up count to increase.');
  assert(
    followUpResult.assistantReply.includes('状态是如何持久化的') && followUpResult.assistantReply.includes('非法状态转移'),
    'Expected the tool to use the model-provided follow-up question in normal mode.',
  );
  assert(
    firstFollowUpQuestion.includes('状态是如何持久化的') && firstFollowUpQuestion.includes('非法状态转移'),
    'Expected the first follow-up to preserve the model-provided question text.',
  );
  return followUpResult.state;
}

function runGuaranteedProfessionalFollowUpAssertions(state: InterviewSessionState): InterviewSessionState {
  const secondFollowUpResult = applyUserReply({
    state,
    userMessage: '我会把审批节点建成状态机控制的人工断点，并记录审批上下文和恢复点。',
    evaluation: {
      classification: 'direct-answer',
      score: {
        relevance: 8.5,
        accuracy: 8,
        depth: 7.5,
        specificity: 7.5,
        clarity: 8,
        weightedTotal: 8.0,
      },
      strengths: ['能够给出具体设计思路'],
      missingPoints: [],
      incorrectPoints: [],
      recommendedIntent: 'experience',
      followUpFocus: ['真实项目中的审批恢复策略'],
      followUpQuestion: '请继续围绕这道题，从系统设计层面说明审批恢复链路的架构决策、异常路径，以及你会如何验证这套设计。',
      detourReply: null,
      clarificationReply: null,
      shouldCompleteNode: true,
      earlyCompletionReason: null,
    },
  });

  const activeRound = secondFollowUpResult.state.rounds.find((round) => round.id === secondFollowUpResult.state.activeRoundId);
  const activeNode = activeRound?.nodes.find((node) => node.id === activeRound.activeNodeId);
  const secondFollowUpQuestion = activeNode?.followUps.find((followUp) => followUp.index === 2)?.question ?? '';

  assert(activeNode?.status === 'awaiting-follow-up-answer', 'Expected professional round to continue into a second follow-up.');
  assert(activeNode?.followUpCount === 2, 'Expected professional round to guarantee at least two follow-ups.');
  assert(
    secondFollowUpResult.assistantReply.includes('系统设计层面') && secondFollowUpResult.assistantReply.includes('架构决策'),
    'Expected the second follow-up reply to use the supplied architecture-level question.',
  );
  assert(
    secondFollowUpQuestion.includes('系统设计层面') && secondFollowUpQuestion.includes('架构决策'),
    'Expected the second follow-up to preserve the supplied architecture and validation depth.',
  );

  return secondFollowUpResult.state;
}

function runThirdFollowUpAssertions(state: InterviewSessionState): InterviewSessionState {
  const thirdFollowUpResult = applyUserReply({
    state,
    userMessage: '在真实项目里，我会把审批任务、超时重试、人工驳回和恢复链路全部挂到同一个可观测状态机上。',
    evaluation: {
      classification: 'deep-answer',
      score: {
        relevance: 9,
        accuracy: 9,
        depth: 8.5,
        specificity: 8.5,
        clarity: 8.5,
        weightedTotal: 8.78,
      },
      strengths: ['能够把原理和真实项目实践结合起来'],
      missingPoints: ['还可以补充审批失败后的指标监控方式'],
      incorrectPoints: [],
      recommendedIntent: 'depth',
      followUpFocus: ['审批失败监控指标'],
      followUpQuestion: '继续围绕当前问题，请按线上高压场景说明审批失败后的监控指标、告警阈值、回滚方案，以及为什么不选其他备选方案。',
      detourReply: null,
      clarificationReply: null,
      shouldCompleteNode: true,
      earlyCompletionReason: null,
    },
  });

  const activeRound = thirdFollowUpResult.state.rounds.find((round) => round.id === thirdFollowUpResult.state.activeRoundId);
  const activeNode = activeRound?.nodes.find((node) => node.id === activeRound.activeNodeId);
  const thirdFollowUpQuestion = activeNode?.followUps.find((followUp) => followUp.index === 3)?.question ?? '';

  assert(activeNode?.status === 'awaiting-follow-up-answer', 'Expected open gaps after the second follow-up to trigger a third follow-up.');
  assert(activeNode?.followUpCount === 3, 'Expected professional round to allow a third follow-up when key gaps remain.');
  assert(
    thirdFollowUpQuestion.includes('线上高压场景') && thirdFollowUpQuestion.includes('监控指标') && thirdFollowUpQuestion.includes('回滚'),
    'Expected the third follow-up to preserve the supplied production-grade follow-up question.',
  );

  return thirdFollowUpResult.state;
}

function runNodeCompletionAssertions(state: InterviewSessionState): InterviewSessionState {
  const currentRound = state.rounds.find((round) => round.id === state.activeRoundId);
  const currentNode = currentRound?.nodes.find((node) => node.id === currentRound.activeNodeId);
  const nextNodeQuestion = currentRound?.nodes.find((node) => node.id !== currentNode?.id)?.mainQuestion ?? '';

  const completionResult = applyUserReply({
    state,
    userMessage: '我还会补上审批失败后的指标监控、告警分级和人工恢复 SLA，并把这些数据沉淀到复盘面板里。',
    evaluation: {
      classification: 'direct-answer',
      score: {
        relevance: 8.5,
        accuracy: 8.5,
        depth: 8,
        specificity: 8,
        clarity: 8,
        weightedTotal: 8.23,
      },
      strengths: ['能够补齐监控与恢复策略'],
      missingPoints: ['可以继续补充审批链路中的量化指标基线'],
      incorrectPoints: [],
      recommendedIntent: 'depth',
      followUpFocus: ['审批链路量化指标'],
      detourReply: null,
      clarificationReply: null,
      shouldCompleteNode: true,
      earlyCompletionReason: null,
    },
  });

  assert(completionResult.assistantReply.includes('回答纠正'), 'Expected correction summary to be included before moving to the next question.');
  assert(completionResult.assistantReply.includes(nextNodeQuestion), 'Expected the state machine to advance to the next question after the follow-up loop completes.');

  return completionResult.state;
}

function runWrapUpAssertions(state: InterviewSessionState): void {
  const wrapUpResult = applyUserReply({
    state,
    userMessage: '请结束面试并给我报告。',
    evaluation: {
      classification: 'stop-request',
      score: null,
      strengths: [],
      missingPoints: [],
      incorrectPoints: [],
      recommendedIntent: 'depth',
      followUpFocus: [],
      detourReply: null,
      clarificationReply: null,
      shouldCompleteNode: true,
      earlyCompletionReason: null,
    },
  });

  assert(!wrapUpResult.state.finalReportReady, 'Expected stop-request to be deferred while questions still remain.');
  assert(wrapUpResult.assistantReply.includes('当前还有'), 'Expected the state machine to explain that questions remain before reporting.');
  assert(wrapUpResult.assistantReply.includes('我会在所有问题结束后再给出面试报告'), 'Expected the guard reply to defer the report until the interview is complete.');
}

function main(): void {
  runRecoveryAssertions();
  const initializedState = runInitializationAssertions();
  runQuestionCountAssertions();
  runPerSkillDefaultAssertions();
  runProfessionalQuestionPlanningAssertions();
  const detourState = runDetourAssertions(initializedState);
  const firstFollowUpState = runFollowUpAssertions(detourState);
  const secondFollowUpState = runGuaranteedProfessionalFollowUpAssertions(firstFollowUpState);
  const thirdFollowUpState = runThirdFollowUpAssertions(secondFollowUpState);
  const advancedState = runNodeCompletionAssertions(thirdFollowUpState);
  runWrapUpAssertions(advancedState);
  console.log('Interview state machine logic validation passed.');
}

main();