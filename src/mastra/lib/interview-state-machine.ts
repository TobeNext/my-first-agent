import {
  answerClassificationSchema,
  answerAttemptStateSchema,
  type AnswerAttemptState,
  type AnswerClassification,
  type AnswerScore,
  type AnswerTargetType,
  DEFAULT_PROFESSIONAL_QUESTION_COUNT,
  DEFAULT_PROJECT_QUESTION_COUNT,
  followUpIntentSchema,
  type FollowUpIntent,
  type FollowUpState,
  interviewSessionStateSchema,
  type InterviewQuestionCandidate,
  type InterviewRoundState,
  type InterviewSessionState,
  type InterviewSystemSettings,
  type InterviewTopicNodeState,
  MAX_TOTAL_QUESTION_COUNT,
  MAX_DETOUR_RESPONSES,
  interviewSystemSettingsSchema,
  PROFESSIONAL_MAX_FOLLOW_UPS,
  professionalQuestionModeSchema,
  PROJECT_MAX_FOLLOW_UPS,
  type ResponseLanguage,
} from './interview-state-machine-schema';

interface KickoffConfig {
  readonly targetRole: string;
  readonly directionSource: 'preset' | 'custom' | 'derived';
  readonly selectedDirection: string;
  readonly settings: InterviewSystemSettings;
  readonly responseLanguage: ResponseLanguage;
}

interface InitializeInterviewSessionOptions {
  readonly threadId: string;
  readonly rawKickoffMessage: string;
  readonly professionalSkills: string;
  readonly projectExperience: string;
  readonly jobDescription: string;
  readonly professionalQuestions: readonly InterviewQuestionCandidate[];
  readonly projectQuestions: readonly InterviewQuestionCandidate[];
}

interface AnswerEvaluationResult {
  readonly classification: AnswerClassification;
  readonly score: AnswerScore | null;
  readonly strengths: readonly string[];
  readonly missingPoints: readonly string[];
  readonly incorrectPoints: readonly string[];
  readonly recommendedIntent: FollowUpIntent;
  readonly followUpFocus: readonly string[];
  readonly followUpQuestion?: string | null;
  readonly detourReply: string | null;
  readonly clarificationReply: string | null;
  readonly shouldCompleteNode: boolean;
  readonly earlyCompletionReason: string | null;
}

interface ProcessAnswerResult {
  readonly state: InterviewSessionState;
  readonly assistantReply: string;
}

export interface InterviewProgressSummary {
  readonly totalQuestionCount: number;
  readonly completedQuestionCount: number;
  readonly remainingQuestionCount: number;
  readonly currentQuestionIndex: number | null;
  readonly currentRoundType: InterviewRoundState['type'] | null;
  readonly currentRoundLabel: string | null;
  readonly currentStage: 'main-question' | 'follow-up' | 'completed';
  readonly currentFollowUpIndex: number | null;
  readonly currentQuestionText: string | null;
  readonly currentNodeTopic: string | null;
}

const DETOUR_CLASSIFICATIONS = new Set<AnswerClassification>(['off-topic', 'meta-question']);
const ACTIVE_ATTEMPT_LIMIT = 2;
const DEFAULT_COMPANY = null;

function hasChinese(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function detectResponseLanguage(input: string): ResponseLanguage {
  return hasChinese(input) ? 'zh' : 'en';
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function splitNonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function uniqueByNormalizedText(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeWhitespace(value).toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalizeWhitespace(value));
  }

  return result;
}

function clampScore(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(10, Number(value.toFixed(2))));
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const total = values.reduce((sum, current) => sum + current, 0);
  return clampScore(total / values.length);
}

function buildWeightedTotal(score: Omit<AnswerScore, 'weightedTotal'>): AnswerScore {
  const weightedTotal = clampScore(
    score.relevance * 0.25 +
      score.accuracy * 0.25 +
      score.depth * 0.25 +
      score.specificity * 0.15 +
      score.clarity * 0.1,
  );

  return {
    ...score,
    weightedTotal,
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseBooleanSetting(rawKickoffMessage: string, label: string, defaultValue: boolean): boolean {
  const pattern = new RegExp(`${label}:\\s*(enabled|disabled|yes|no)`, 'i');
  const match = rawKickoffMessage.match(pattern);
  if (!match) {
    return defaultValue;
  }

  return match[1] === 'enabled' || match[1] === 'yes';
}

function parseIntegerSetting(rawKickoffMessage: string, label: string, defaultValue: number): number {
  const pattern = new RegExp(`${label}:\\s*(\\d+)`, 'i');
  const match = rawKickoffMessage.match(pattern);
  if (!match) {
    return defaultValue;
  }

  const value = Number.parseInt(match[1], 10);
  if (Number.isNaN(value)) {
    return defaultValue;
  }

  return Math.min(MAX_TOTAL_QUESTION_COUNT, Math.max(0, value));
}

function parseProfessionalQuestionMode(rawKickoffMessage: string, defaultValue: 'per-skill-default' | 'custom-count'): 'per-skill-default' | 'custom-count' {
  const match = rawKickoffMessage.match(/Professional question mode:\s*(per-skill-default|custom-count)/i);
  if (!match) {
    return defaultValue;
  }

  return professionalQuestionModeSchema.parse(match[1].toLowerCase());
}

function deriveTargetRole(rawKickoffMessage: string): string {
  const selectedDirectionMatch = rawKickoffMessage.match(/Selected interview direction:\s*(.+)/i);
  const selectedDirection = selectedDirectionMatch?.[1]?.trim();
  if (selectedDirection && selectedDirection.toLowerCase() !== 'unknown') {
    return selectedDirection;
  }

  const explicitRolePatterns = [
    /practice for (?:a|an|the)?\s*(.+?)\s+interview/i,
    /for (?:a|an|the)?\s*(.+?)\s+at\s+/i,
    /练习\s*(.+?)\s*的面试/i,
    /想练习\s*(.+?)\s*面试/i,
  ];

  for (const pattern of explicitRolePatterns) {
    const match = rawKickoffMessage.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate) {
      return candidate;
    }
  }

  return hasChinese(rawKickoffMessage) ? '通用技术岗位' : 'General Technical Role';
}

function parseKickoffConfig(rawKickoffMessage: string, professionalSkills: string, projectExperience: string): KickoffConfig {
  const selectedDirection = deriveTargetRole(rawKickoffMessage);
  const directionSourceMatch = rawKickoffMessage.match(/Direction source:\s*(preset|custom|unknown)/i);
  const directionSource = directionSourceMatch?.[1]?.toLowerCase();
  const combinedContext = `${rawKickoffMessage}\n${professionalSkills}\n${projectExperience}`;
  const skipProfessionalSkillsRound = parseBooleanSetting(rawKickoffMessage, 'Skip professional-skills round', false);
  const skipProjectExperienceRound = parseBooleanSetting(rawKickoffMessage, 'Skip project-experience round', false);
  const professionalSkillGroups = extractResumeTopics(professionalSkills);
  const requestedProfessionalQuestionCount = skipProfessionalSkillsRound
    ? 0
    : parseIntegerSetting(
        rawKickoffMessage,
        'Professional question count',
        professionalSkillGroups.length > 0 ? professionalSkillGroups.length : DEFAULT_PROFESSIONAL_QUESTION_COUNT,
      );
  const professionalQuestionMode = parseProfessionalQuestionMode(
    rawKickoffMessage,
    professionalSkillGroups.length > 0 && requestedProfessionalQuestionCount === professionalSkillGroups.length
      ? 'per-skill-default'
      : 'custom-count',
  );
  const professionalQuestionCount = skipProfessionalSkillsRound
    ? 0
    : professionalQuestionMode === 'per-skill-default'
      ? professionalSkillGroups.length
      : requestedProfessionalQuestionCount;

  return {
    targetRole: selectedDirection,
    selectedDirection,
    directionSource:
      directionSource === 'preset' || directionSource === 'custom' ? directionSource : 'derived',
    settings: interviewSystemSettingsSchema.parse({
      reviewIncorrectOrMissingPoints: parseBooleanSetting(
        rawKickoffMessage,
        'Review incorrect or missing points after each completed question',
        true,
      ),
      skipProfessionalSkillsRound,
      skipProjectExperienceRound,
      enableFlowTestMode: parseBooleanSetting(rawKickoffMessage, 'Flow test mode', false),
      professionalQuestionMode,
      professionalQuestionCount,
      projectQuestionCount: skipProjectExperienceRound
        ? 0
        : parseIntegerSetting(rawKickoffMessage, 'Project question count', DEFAULT_PROJECT_QUESTION_COUNT),
    }),
    responseLanguage: detectResponseLanguage(combinedContext),
  };
}

export function extractResumeTopics(sectionText: string): string[] {
  const lines = splitNonEmptyLines(sectionText).filter((line) => line !== '...');
  const bulletLines = lines.filter((line) => /^[-*]\s+/.test(line));
  const groupedLines = (bulletLines.length > 0 ? bulletLines : lines)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter((line) => line.length > 1);

  return uniqueByNormalizedText(groupedLines).slice(0, 8);
}

function inferTopicFromQuestion(questionText: string, fallbackRole: string): string {
  const cleaned = normalizeWhitespace(
    questionText
      .replace(/[?？]\s*$/, '')
      .replace(/^请你?/, '')
      .replace(/^Could you/i, '')
      .replace(/^Can you/i, ''),
  );
  const firstClause = cleaned.split(/[。.!?？；;，,]/)[0]?.trim();
  if (firstClause && firstClause.length <= 32) {
    return firstClause;
  }

  return cleaned.slice(0, 32) || fallbackRole;
}

function buildFallbackQuestion(topic: string, targetRole: string, language: ResponseLanguage, roundType: 'professional' | 'project'): string {
  if (language === 'zh') {
    return roundType === 'professional'
      ? `请结合 ${targetRole} 岗位，系统说明你在“${topic}”这个方向的理解、实践经验、关键取舍以及常见风险。`
      : `请结合你做过的项目，详细说明“${topic}”相关经历中的背景、目标、你的职责、关键决策和最终结果。`;
  }

  return roundType === 'professional'
    ? `For the ${targetRole} role, walk me through your understanding of ${topic}, including your practical experience, trade-offs, and common risks.`
    : `Using a real project example, explain your experience with ${topic}, including the context, your role, key decisions, and the outcome.`;
}

function createFollowUpSlots(maxFollowUps: number): FollowUpState[] {
  const baseIntents: readonly FollowUpIntent[] = ['depth', 'accuracy', 'experience', 'breadth'];

  return Array.from({ length: maxFollowUps }, (_, index) => ({
    id: createId(`follow-up-${index + 1}`),
    index: index + 1,
    intent: baseIntents[index] ?? 'depth',
    question: '',
    status: 'pending',
    linkedAnswerId: null,
  }));
}

function createNode(options: {
  readonly source: 'resume' | 'knowledge-base' | 'setup' | 'generated';
  readonly topic: string;
  readonly mainQuestion: string;
  readonly maxFollowUps: number;
}): InterviewTopicNodeState {
  return {
    id: createId('topic-node'),
    topic: options.topic,
    source: options.source,
    mainQuestion: options.mainQuestion,
    status: 'pending',
    currentTargetType: 'main-question',
    currentFollowUpId: null,
    followUpCount: 0,
    maxFollowUps: options.maxFollowUps,
    detourResponseCount: 0,
    earlyCompletionReason: null,
    followUps: createFollowUpSlots(options.maxFollowUps),
    answerAttempts: [],
    aggregatedScore: null,
    summary: null,
  };
}

function buildNodesFromQuestions(options: {
  readonly questions: readonly InterviewQuestionCandidate[];
  readonly fallbackTopics: readonly string[];
  readonly targetRole: string;
  readonly language: ResponseLanguage;
  readonly nodeCount: number;
  readonly maxFollowUps: number;
  readonly roundType: 'professional' | 'project';
}): InterviewTopicNodeState[] {
  const uniqueQuestions = uniqueByNormalizedText(options.questions.map((question) => question.text)).map((text) =>
    options.questions.find((question) => normalizeWhitespace(question.text) === text) ?? {
      id: createId('question-fallback'),
      text,
    },
  );
  const nodes: InterviewTopicNodeState[] = [];

  for (const question of uniqueQuestions.slice(0, options.nodeCount)) {
    nodes.push(
      createNode({
        source: 'knowledge-base',
        topic: inferTopicFromQuestion(question.text, options.targetRole),
        mainQuestion: question.text,
        maxFollowUps: options.maxFollowUps,
      }),
    );
  }

  for (const topic of options.fallbackTopics) {
    if (nodes.length >= options.nodeCount) {
      break;
    }

    nodes.push(
      createNode({
        source: 'resume',
        topic,
        mainQuestion: buildFallbackQuestion(topic, options.targetRole, options.language, options.roundType),
        maxFollowUps: options.maxFollowUps,
      }),
    );
  }

  while (nodes.length < options.nodeCount) {
    const topic =
      options.roundType === 'professional'
        ? `${options.targetRole} core competency ${nodes.length + 1}`
        : `${options.targetRole} project experience ${nodes.length + 1}`;

    nodes.push(
      createNode({
        source: 'generated',
        topic,
        mainQuestion: buildFallbackQuestion(topic, options.targetRole, options.language, options.roundType),
        maxFollowUps: options.maxFollowUps,
      }),
    );
  }

  return nodes;
}

function createRound(type: 'professional-skills' | 'project-experience', nodes: InterviewTopicNodeState[]): InterviewRoundState {
  return {
    id: createId(`${type}-round`),
    type,
    status: 'pending',
    plannedNodeCount: nodes.length,
    completedNodeCount: 0,
    activeNodeId: nodes[0]?.id ?? null,
    nodeOrder: nodes.map((node) => node.id),
    nodes,
  };
}

function startNode(node: InterviewTopicNodeState): InterviewTopicNodeState {
  return {
    ...node,
    status: 'awaiting-main-answer',
    currentTargetType: 'main-question',
    currentFollowUpId: null,
    detourResponseCount: 0,
  };
}

function startRound(round: InterviewRoundState): InterviewRoundState {
  const activeNode = round.nodes.find((node) => node.id === round.activeNodeId) ?? round.nodes[0];
  const startedNode = activeNode ? startNode(activeNode) : null;

  return {
    ...round,
    status: 'in-progress',
    activeNodeId: startedNode?.id ?? null,
    nodes: round.nodes.map((node) => (node.id === startedNode?.id ? startedNode : node)),
  };
}

function getRoundLabel(roundType: 'professional-skills' | 'project-experience', language: ResponseLanguage): string {
  if (roundType === 'professional-skills') {
    return language === 'zh' ? '【第一轮：专业技能面试】' : '[Round 1: Professional Skills Interview]';
  }

  return language === 'zh' ? '【第二轮：项目经历面试】' : '[Round 2: Project Experience Interview]';
}

function buildGreeting(state: InterviewSessionState): string {
  const round = getActiveRound(state);
  const roundLabel = round ? getRoundLabel(round.type, state.responseLanguage) : '';
  const totalQuestionCount = state.rounds.reduce((total, currentRound) => total + currentRound.plannedNodeCount, 0);
  const skippedMessages: string[] = [];

  if (state.setup.settings.skipProfessionalSkillsRound) {
    skippedMessages.push(
      state.responseLanguage === 'zh'
        ? '根据你的设置，我会跳过第一轮专业技能面试。'
        : 'Based on your settings, I will skip the professional-skills round.',
    );
  }

  if (state.setup.settings.skipProjectExperienceRound) {
    skippedMessages.push(
      state.responseLanguage === 'zh'
        ? '根据你的设置，我会在第一轮后跳过项目经历面试。'
        : 'Based on your settings, I will skip the project-experience round after round 1.',
    );
  }

  const baseIntro =
    state.responseLanguage === 'zh'
      ? `我们将围绕 ${state.targetRole} 岗位进行一场结构化模拟面试。本次共安排 ${totalQuestionCount} 道主问题，并在每道题后根据回答继续追问。`
      : `We will run a structured mock interview for the ${state.targetRole} role. This session includes ${totalQuestionCount} main questions, with follow-up questions based on your answers.`;

  const firstQuestion = getCurrentQuestion(state);
  const questionLine = firstQuestion
    ? `${roundLabel}\n${firstQuestion}`
    : roundLabel;

  return [baseIntro, ...skippedMessages, questionLine].filter((item) => item.length > 0).join('\n\n');
}

function getActiveRound(state: InterviewSessionState): InterviewRoundState | null {
  return state.rounds.find((round) => round.id === state.activeRoundId) ?? null;
}

function getActiveNode(round: InterviewRoundState | null): InterviewTopicNodeState | null {
  if (!round) {
    return null;
  }

  return round.nodes.find((node) => node.id === round.activeNodeId) ?? null;
}

function getCurrentQuestion(state: InterviewSessionState): string | null {
  const node = getActiveNode(getActiveRound(state));
  if (!node) {
    return null;
  }

  if (node.currentTargetType === 'main-question') {
    return node.mainQuestion;
  }

  const followUp = node.followUps.find((item) => item.id === node.currentFollowUpId);
  return followUp?.question ?? node.mainQuestion;
}

function getOrderedNodes(state: InterviewSessionState): InterviewTopicNodeState[] {
  return state.rounds.flatMap((round) =>
    round.nodeOrder
      .map((nodeId) => round.nodes.find((node) => node.id === nodeId) ?? null)
      .filter((node): node is InterviewTopicNodeState => node !== null),
  );
}

export function buildInterviewProgressSummary(state: InterviewSessionState): InterviewProgressSummary {
  const orderedNodes = getOrderedNodes(state);
  const totalQuestionCount = orderedNodes.length;
  const completedQuestionCount = orderedNodes.filter((node) => node.status === 'completed' || node.status === 'skipped').length;
  const activeRound = getActiveRound(state);
  const activeNode = getActiveNode(activeRound);
  const currentFollowUp = activeNode?.followUps.find((followUp) => followUp.id === activeNode.currentFollowUpId) ?? null;

  return {
    totalQuestionCount,
    completedQuestionCount,
    remainingQuestionCount: Math.max(0, totalQuestionCount - completedQuestionCount),
    currentQuestionIndex: activeNode ? Math.min(totalQuestionCount, completedQuestionCount + 1) : null,
    currentRoundType: activeRound?.type ?? null,
    currentRoundLabel: activeRound ? getRoundLabel(activeRound.type, state.responseLanguage) : null,
    currentStage: !activeNode ? 'completed' : activeNode.currentTargetType,
    currentFollowUpIndex: currentFollowUp?.index ?? null,
    currentQuestionText: getCurrentQuestion(state),
    currentNodeTopic: activeNode?.topic ?? null,
  };
}

function compressCompletedNode(node: InterviewTopicNodeState): InterviewTopicNodeState {
  const evidence = node.answerAttempts
    .slice(-ACTIVE_ATTEMPT_LIMIT)
    .map((attempt) => attempt.userMessage.slice(0, 180));
  const summary = node.summary ?? {
    strengths: [],
    weaknesses: [],
    missingPoints: [],
    improvementAdvice: [],
    evidence,
  };

  return {
    ...node,
    answerAttempts: node.answerAttempts.slice(-ACTIVE_ATTEMPT_LIMIT),
    followUps: node.followUps.filter((followUp) => followUp.status !== 'pending'),
    summary: {
      ...summary,
      evidence,
    },
  };
}

function updateRound(state: InterviewSessionState, updatedRound: InterviewRoundState): InterviewSessionState {
  return {
    ...state,
    rounds: state.rounds.map((round) => (round.id === updatedRound.id ? updatedRound : round)),
  };
}

function updateNode(round: InterviewRoundState, updatedNode: InterviewTopicNodeState): InterviewRoundState {
  return {
    ...round,
    nodes: round.nodes.map((node) => (node.id === updatedNode.id ? updatedNode : node)),
  };
}

function moveToNextNode(round: InterviewRoundState): InterviewRoundState {
  const currentIndex = round.nodeOrder.findIndex((nodeId) => nodeId === round.activeNodeId);
  const nextNodeId = round.nodeOrder.slice(currentIndex + 1).find((nodeId) => {
    const node = round.nodes.find((item) => item.id === nodeId);
    return node && node.status === 'pending';
  }) ?? null;

  if (!nextNodeId) {
    return {
      ...round,
      activeNodeId: null,
      status: 'completed',
    };
  }

  return startRound({
    ...round,
    activeNodeId: nextNodeId,
  });
}

function buildCorrectionSummary(node: InterviewTopicNodeState, language: ResponseLanguage): string | null {
  const missingPoints = node.summary?.missingPoints ?? [];
  const incorrectPoints = node.summary?.weaknesses ?? [];

  if (missingPoints.length === 0 && incorrectPoints.length === 0) {
    return null;
  }

  const heading = language === 'zh' ? '回答纠正' : 'Answer Review';
  const lines = [heading];

  for (const item of missingPoints.slice(0, 2)) {
    lines.push(language === 'zh' ? `- 漏答点：${item}` : `- Missing point: ${item}`);
  }

  for (const item of incorrectPoints.slice(0, 2)) {
    lines.push(language === 'zh' ? `- 需要修正：${item}` : `- Needs correction: ${item}`);
  }

  return lines.join('\n');
}

function buildFollowUpQuestion(options: {
  readonly language: ResponseLanguage;
  readonly intent: FollowUpIntent;
  readonly focus: readonly string[];
  readonly node: InterviewTopicNodeState;
  readonly followUpIndex: number;
  readonly enableFlowTestMode: boolean;
  readonly generatedQuestion?: string | null;
}): string {
  const generatedQuestion = options.generatedQuestion?.trim();
  if (!options.enableFlowTestMode && generatedQuestion) {
    return generatedQuestion;
  }

  const normalizedFocus = options.focus.find((item) => normalizeWhitespace(item).length > 0) ?? options.node.topic;
  if (!options.enableFlowTestMode) {
    if (options.language === 'zh') {
      if (options.followUpIndex <= 1) {
        return `请详细说说你提到的“${normalizedFocus}”，重点展开你对它的理解。`;
      }

      if (options.followUpIndex === 2) {
        return `请继续围绕“${normalizedFocus}”说明它的具体应用场景、实现方式，或者其中几个关键区别。`;
      }

      return `继续围绕“${normalizedFocus}”往下讲，补充它在实际使用中的细节、限制、取舍或边界情况。`;
    }

    if (options.followUpIndex <= 1) {
      return `Please explain what you mentioned about ${normalizedFocus} in more detail.`;
    }

    if (options.followUpIndex === 2) {
      return `Please continue with ${normalizedFocus} and explain the concrete use cases, implementation approach, or key distinctions inside it.`;
    }

    return `Please keep going on ${normalizedFocus} and add the practical details, limitations, trade-offs, or edge cases that matter in real use.`;
  }

  const escalationDirective = (() => {
    if (options.language === 'zh') {
      if (options.followUpIndex >= 3) {
        return '这次请直接按线上高压场景作答，明确给出失败案例、监控指标或阈值、降级或回滚方案，以及为什么不选其他方案。';
      }

      if (options.followUpIndex === 2) {
        return '这次请提升到系统设计层面，不要只停留在概念解释，要说清楚架构决策、异常路径和验证手段。';
      }

      return '不要停留在高层描述，请补充关键实现细节、判断依据或真实约束。';
    }

    if (options.followUpIndex >= 3) {
      return 'Answer it as a production-pressure scenario: include a failure case, the metrics or thresholds you would watch, the fallback or rollback plan, and why you would reject the alternatives.';
    }

    if (options.followUpIndex === 2) {
      return 'Raise it to the system-design level this time. Do not stay at the concept level; explain the architecture decision, failure path, and how you would validate the design.';
    }

    return 'Do not stay high level this time; add concrete implementation detail, evidence, or real constraints.';
  })();

  if (options.language === 'zh') {
    switch (options.intent) {
      case 'accuracy':
        return `你刚才提到了“${normalizedFocus}”。请更准确地说明它的实现方式、关键约束以及容易出错的地方。${escalationDirective}`;
      case 'experience':
        return `请结合你真实做过的项目，详细说明你是如何处理“${normalizedFocus}”的，最终效果如何？${escalationDirective}`;
      case 'breadth':
        return `除了你刚才提到的内容之外，在“${normalizedFocus}”这个方向上，你还会优先考虑哪些关键点？${escalationDirective}`;
      case 'depth':
      default:
        return `你刚才的回答里提到了“${normalizedFocus}”。请继续往下展开，重点说明背后的原理、取舍和边界条件。${escalationDirective}`;
    }
  }

  switch (options.intent) {
    case 'accuracy':
      return `You mentioned ${normalizedFocus}. Please explain it more precisely, including the implementation details, key constraints, and common failure points. ${escalationDirective}`;
    case 'experience':
      return `Use a real project example to explain how you handled ${normalizedFocus} and what outcome you achieved. ${escalationDirective}`;
    case 'breadth':
      return `Beyond what you already mentioned, what other key considerations would you include when dealing with ${normalizedFocus}? ${escalationDirective}`;
    case 'depth':
    default:
      return `You brought up ${normalizedFocus}. Please go one level deeper and explain the underlying principles, trade-offs, and edge cases. ${escalationDirective}`;
  }
}

function buildClarificationReply(state: InterviewSessionState, node: InterviewTopicNodeState): string {
  const question = getCurrentQuestion(state) ?? node.mainQuestion;

  if (state.responseLanguage === 'zh') {
    return `这道题我主要想了解三点：第一，你是否理解“${node.topic}”背后的核心原理；第二，你是否做过相关实践；第三，你能否说明关键取舍和风险。请继续围绕这个问题回答：\n${question}`;
  }

  return `For this question, I want to understand three things: whether you know the core principles behind ${node.topic}, whether you have practical experience, and whether you can explain the main trade-offs and risks. Please continue with this question:\n${question}`;
}

function buildDetourReply(state: InterviewSessionState, node: InterviewTopicNodeState): string {
  const currentQuestion = getCurrentQuestion(state) ?? node.mainQuestion;

  if (node.detourResponseCount > MAX_DETOUR_RESPONSES) {
    return state.responseLanguage === 'zh'
      ? `我先把当前问题收回来。请直接回答这道题：\n${currentQuestion}`
      : `Let me pull us back to the current question. Please answer this question directly:\n${currentQuestion}`;
  }

  return state.responseLanguage === 'zh'
    ? `我先简短回应到这里，但我们还在当前问题上。请继续回答：\n${currentQuestion}`
    : `I will keep the detour brief, but we still need to finish the current question. Please continue here:\n${currentQuestion}`;
}

function summarizeNode(node: InterviewTopicNodeState, language: ResponseLanguage): InterviewTopicNodeState {
  const scoredAttempts = node.answerAttempts.filter((attempt) => attempt.score !== null);
  const aggregatedScore = average(scoredAttempts.map((attempt) => attempt.score?.weightedTotal ?? 0));
  const strengths = uniqueByNormalizedText(scoredAttempts.flatMap((attempt) => attempt.strengths)).slice(0, 3);
  const missingPoints = uniqueByNormalizedText(scoredAttempts.flatMap((attempt) => attempt.missingPoints)).slice(0, 3);
  const incorrectPoints = uniqueByNormalizedText(scoredAttempts.flatMap((attempt) => attempt.incorrectPoints)).slice(0, 3);
  const improvementAdvice = missingPoints.map((item) =>
    language === 'zh' ? `补充说明：${item}` : `Strengthen your answer on: ${item}`,
  );

  return {
    ...node,
    aggregatedScore,
    summary: {
      strengths,
      weaknesses: incorrectPoints,
      missingPoints,
      improvementAdvice,
      evidence: node.answerAttempts.slice(-ACTIVE_ATTEMPT_LIMIT).map((attempt) => attempt.userMessage.slice(0, 180)),
    },
  };
}

function getNodeImprovementPoints(node: InterviewTopicNodeState): string[] {
  return uniqueByNormalizedText([...(node.summary?.missingPoints ?? []), ...(node.summary?.weaknesses ?? [])]).slice(0, 4);
}

function buildQuestionAnswerStatus(node: InterviewTopicNodeState, language: ResponseLanguage): string {
  const score = node.aggregatedScore ?? 0;
  const improvementPoints = getNodeImprovementPoints(node);

  if (language === 'zh') {
    if (score >= 8.5 && improvementPoints.length === 0) {
      return '回答比较完整，核心原理、实践细节和取舍说明都比较到位。';
    }

    if (score >= 7) {
      return improvementPoints.length > 0
        ? '回答整体相关且结构清晰，但仍有个别关键点可以继续补强。'
        : '回答整体相关，已经覆盖了主要考察点。';
    }

    return improvementPoints.length > 0
      ? '回答和题目相关，但深度或准确性还不够稳定，需要围绕关键遗漏点继续强化。'
      : '回答基础相关，但还需要补充更扎实的原理、细节和案例。';
  }

  if (score >= 8.5 && improvementPoints.length === 0) {
    return 'The answer was complete and covered principles, implementation detail, and trade-offs well.';
  }

  if (score >= 7) {
    return improvementPoints.length > 0
      ? 'The answer was relevant and structured, but a few important points still need to be strengthened.'
      : 'The answer was relevant and covered the main evaluation points.';
  }

  return improvementPoints.length > 0
    ? 'The answer was relevant, but depth or accuracy was not yet stable and the key gaps need more work.'
    : 'The answer was directionally relevant, but it still needs stronger principles, detail, and examples.';
}

function renderInterviewReportFromTemplate(state: InterviewSessionState, completedNodes: readonly InterviewTopicNodeState[]): string {
  const overallScore = average(completedNodes.map((node) => node.aggregatedScore ?? 0)) ?? 0;
  const strengths = uniqueByNormalizedText(completedNodes.flatMap((node) => node.summary?.strengths ?? [])).slice(0, 4);
  const weaknesses = uniqueByNormalizedText(completedNodes.flatMap((node) => getNodeImprovementPoints(node))).slice(0, 4);

  if (state.responseLanguage === 'zh') {
    const lines = [
      '## 模拟面试报告',
      '',
      `**目标岗位**: ${state.targetRole}`,
      `**完成题数**: ${completedNodes.length}`,
      `**综合得分**: ${overallScore.toFixed(1)}/10`,
      '',
      '### 单题复盘',
      ...completedNodes.flatMap((node, index) => {
        const goodPoints = node.summary?.strengths ?? [];
        const improvementPoints = getNodeImprovementPoints(node);

        return [
          `#### 第 ${index + 1} 题`,
          `**题目**: ${node.mainQuestion}`,
          `**得分**: ${(node.aggregatedScore ?? 0).toFixed(1)}/10`,
          `**回答情况**: ${buildQuestionAnswerStatus(node, state.responseLanguage)}`,
          `**回答不错的点**: ${goodPoints.join('；') || '暂无明显亮点记录'}`,
          `**回答还需改进的点**: ${improvementPoints.join('；') || '暂无明显短板记录'}`,
          '',
        ];
      }),
      '### 总结建议',
      `**整体优势**: ${strengths.join('；') || '整体表达比较稳定，可继续补充更多项目量化细节。'}`,
      `**优先改进项**: ${weaknesses.join('；') || '继续保持当前节奏，并增加更多贴近真实场景的案例和数据。'}`,
    ];

    return lines.join('\n').trim();
  }

  const lines = [
    '## Mock Interview Report',
    '',
    `**Target Role**: ${state.targetRole}`,
    `**Questions Completed**: ${completedNodes.length}`,
    `**Overall Score**: ${overallScore.toFixed(1)}/10`,
    '',
    '### Question Review',
    ...completedNodes.flatMap((node, index) => {
      const goodPoints = node.summary?.strengths ?? [];
      const improvementPoints = getNodeImprovementPoints(node);

      return [
        `#### Question ${index + 1}`,
        `**Question**: ${node.mainQuestion}`,
        `**Score**: ${(node.aggregatedScore ?? 0).toFixed(1)}/10`,
        `**Answer Status**: ${buildQuestionAnswerStatus(node, state.responseLanguage)}`,
        `**What Went Well**: ${goodPoints.join('; ') || 'No clear strengths recorded.'}`,
        `**Needs Improvement**: ${improvementPoints.join('; ') || 'No major weaknesses recorded.'}`,
        '',
      ];
    }),
    '### Summary',
    `**Top Strengths**: ${strengths.join('; ') || 'Communication stayed stable; add more quantified examples next.'}`,
    `**Priority Improvements**: ${weaknesses.join('; ') || 'Keep the structure strong and add more real-world detail and metrics.'}`,
  ];

  return lines.join('\n').trim();
}

function finalizeInterview(state: InterviewSessionState): InterviewSessionState {
  const completedNodes = state.rounds.flatMap((round) => round.nodes).filter((node) => node.status === 'completed');

  return {
    ...state,
    phase: 'completed',
    activeRoundId: null,
    finalReportReady: true,
    finalReport: renderInterviewReportFromTemplate(state, completedNodes),
  };
}

function hasOpenNode(node: InterviewTopicNodeState): boolean {
  return node.status !== 'completed' && node.status !== 'skipped';
}

function countRemainingQuestionNodes(state: InterviewSessionState): number {
  return state.rounds.reduce(
    (count, round) => count + round.nodes.filter((node) => hasOpenNode(node)).length,
    0,
  );
}

function restoreInterviewProgressIfNeeded(state: InterviewSessionState): InterviewSessionState {
  const activeRound = getActiveRound(state);
  const activeNode = getActiveNode(activeRound);
  if (activeRound && activeNode) {
    return state;
  }

  const resumableRound = state.rounds.find((round) => round.nodes.some((node) => hasOpenNode(node))) ?? null;
  if (!resumableRound) {
    return state;
  }

  const nextNodeId =
    resumableRound.activeNodeId ??
    resumableRound.nodeOrder.find((nodeId) => {
      const node = resumableRound.nodes.find((item) => item.id === nodeId);
      return node ? hasOpenNode(node) : false;
    }) ??
    null;
  if (!nextNodeId) {
    return state;
  }

  const nextNode = resumableRound.nodes.find((node) => node.id === nextNodeId) ?? null;
  if (!nextNode) {
    return state;
  }

  const resumedNode = nextNode.status === 'pending' ? startNode(nextNode) : nextNode;
  const resumedRound = {
    ...resumableRound,
    status: 'in-progress' as const,
    activeNodeId: nextNodeId,
    nodes: resumableRound.nodes.map((node) => (node.id === resumedNode.id ? resumedNode : node)),
  };

  return updateRound(
    {
      ...state,
      activeRoundId: resumedRound.id,
      phase: resumedRound.type === 'professional-skills' ? 'professional-skills-round' : 'project-experience-round',
    },
    resumedRound,
  );
}

function buildPendingQuestionsGuardReply(state: InterviewSessionState): string {
  const progress = buildInterviewProgressSummary(state);
  const currentQuestion = getCurrentQuestion(state);

  if (state.responseLanguage === 'zh') {
    const intro = `当前还有 ${progress.remainingQuestionCount} 个问题未完成，我会在所有问题结束后再给出面试报告。我们先继续当前题目。`;
    return [intro, currentQuestion].filter((value): value is string => Boolean(value)).join('\n\n');
  }

  const intro = `There are still ${progress.remainingQuestionCount} questions left. I will give you the interview report only after all questions are finished. Let's continue with the current question first.`;
  return [intro, currentQuestion].filter((value): value is string => Boolean(value)).join('\n\n');
}

function finalizeInterviewIfComplete(state: InterviewSessionState): InterviewSessionState {
  const resumedState = restoreInterviewProgressIfNeeded(state);
  if (countRemainingQuestionNodes(resumedState) > 0) {
    return resumedState;
  }

  return finalizeInterview({
    ...resumedState,
    phase: 'wrap-up',
    activeRoundId: null,
  });
}

function transitionAfterNode(state: InterviewSessionState, round: InterviewRoundState, completedNode: InterviewTopicNodeState): InterviewSessionState {
  const compressedNode = compressCompletedNode(summarizeNode(completedNode, state.responseLanguage));
  let updatedRound = updateNode(round, compressedNode);
  updatedRound = {
    ...updatedRound,
    completedNodeCount: updatedRound.nodes.filter((node) => node.status === 'completed').length,
  };
  updatedRound = moveToNextNode(updatedRound);
  let nextState = updateRound(state, updatedRound);

  if (updatedRound.status === 'completed') {
    if (updatedRound.type === 'professional-skills') {
      const projectRound = nextState.rounds.find((item) => item.type === 'project-experience') ?? null;

      if (!state.setup.settings.skipProjectExperienceRound && projectRound) {
        const hasProjectQuestionsRemaining = projectRound.nodes.some((node) => hasOpenNode(node));
        if (hasProjectQuestionsRemaining) {
          const startedProjectRound = startRound({
            ...projectRound,
            status: 'pending',
            activeNodeId:
              projectRound.activeNodeId ??
              projectRound.nodeOrder.find((nodeId) => {
                const node = projectRound.nodes.find((item) => item.id === nodeId);
                return node ? hasOpenNode(node) : false;
              }) ??
              null,
          });
          nextState = updateRound(nextState, startedProjectRound);
          return {
            ...nextState,
            phase: 'project-experience-round',
            activeRoundId: startedProjectRound.id,
          };
        }
      }

      return finalizeInterviewIfComplete(nextState);
    }

    return finalizeInterviewIfComplete(nextState);
  }

  return nextState;
}

function buildNextQuestionReply(state: InterviewSessionState, correctionSummary: string | null): string {
  const round = getActiveRound(state);
  const currentQuestion = getCurrentQuestion(state);
  const parts = [correctionSummary ?? ''].filter((item) => item !== '');

  if (round) {
    const currentNode = getActiveNode(round);
    const isRoundStart = currentNode?.currentTargetType === 'main-question' && currentNode?.answerAttempts.length === 0;
    if (isRoundStart) {
      parts.push(getRoundLabel(round.type, state.responseLanguage));
    }
  }

  if (currentQuestion) {
    parts.push(currentQuestion);
  }

  return parts.filter((item) => item.length > 0).join('\n\n');
}

function createAnswerAttempt(options: {
  readonly targetType: AnswerTargetType;
  readonly targetId: string;
  readonly userMessage: string;
  readonly evaluation: AnswerEvaluationResult;
  readonly isDetour: boolean;
}): AnswerAttemptState {
  return answerAttemptStateSchema.parse({
    id: createId('answer-attempt'),
    targetType: options.targetType,
    targetId: options.targetId,
    userMessage: options.userMessage,
    classification: options.evaluation.classification,
    score: options.evaluation.score,
    strengths: [...options.evaluation.strengths],
    missingPoints: [...options.evaluation.missingPoints],
    incorrectPoints: [...options.evaluation.incorrectPoints],
    isDetour: options.isDetour,
    createdAt: new Date().toISOString(),
  });
}

function isStrongSignal(message: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

export function classifyByRules(userMessage: string): AnswerClassification | null {
  const normalized = userMessage.trim();

  if (
    isStrongSignal(normalized, [
      /结束面试/i,
      /结束吧/i,
      /wrap up/i,
      /finish (the )?interview/i,
      /stop (the )?interview/i,
      /give me (the )?(evaluation|report)/i,
    ])
  ) {
    return 'stop-request';
  }

  if (isStrongSignal(normalized, [/跳过/i, /先过这一题/i, /skip (this|the) question/i, /next question/i, /pass/i])) {
    return 'skip-request';
  }

  if (
    isStrongSignal(normalized, [
      /什么意思/i,
      /解释一下/i,
      /能详细说明题意吗/i,
      /what do you mean/i,
      /can you clarify/i,
      /can you explain/i,
    ])
  ) {
    return 'clarification-request';
  }

  if (isStrongSignal(normalized, [/怎么评分/i, /为什么问这个/i, /流程是什么/i, /how are you scoring/i, /why are you asking/i])) {
    return 'meta-question';
  }

  return null;
}

export function initializeInterviewSession(options: InitializeInterviewSessionOptions): InterviewSessionState {
  const kickoffConfig = parseKickoffConfig(
    options.rawKickoffMessage,
    options.professionalSkills,
    options.projectExperience,
  );
  const professionalTopics = extractResumeTopics(options.professionalSkills);
  const projectTopics = extractResumeTopics(options.projectExperience);
  const professionalRoundNodes = buildNodesFromQuestions({
    questions: options.professionalQuestions,
    fallbackTopics: professionalTopics,
    targetRole: kickoffConfig.targetRole,
    language: kickoffConfig.responseLanguage,
    nodeCount: kickoffConfig.settings.professionalQuestionCount,
    maxFollowUps: PROFESSIONAL_MAX_FOLLOW_UPS,
    roundType: 'professional',
  });
  const projectRoundNodes = buildNodesFromQuestions({
    questions: options.projectQuestions,
    fallbackTopics: projectTopics,
    targetRole: kickoffConfig.targetRole,
    language: kickoffConfig.responseLanguage,
    nodeCount: kickoffConfig.settings.projectQuestionCount,
    maxFollowUps: PROJECT_MAX_FOLLOW_UPS,
    roundType: 'project',
  });

  const rounds: InterviewRoundState[] = [
    createRound('professional-skills', professionalRoundNodes),
    createRound('project-experience', projectRoundNodes),
  ].map((round) => {
    if (
      (round.type === 'professional-skills' && kickoffConfig.settings.skipProfessionalSkillsRound) ||
      (round.type === 'project-experience' && kickoffConfig.settings.skipProjectExperienceRound)
    ) {
      return {
        ...round,
        status: 'skipped',
        activeNodeId: null,
      };
    }

    return round;
  });

  const firstActiveRound = rounds.find((round) => round.status !== 'skipped') ?? null;
  const startedFirstRound = firstActiveRound ? startRound(firstActiveRound) : null;
  const updatedRounds = rounds.map((round) => (round.id === startedFirstRound?.id ? startedFirstRound : round));
  const phase =
    startedFirstRound?.type === 'professional-skills'
      ? 'professional-skills-round'
      : startedFirstRound?.type === 'project-experience'
        ? 'project-experience-round'
        : 'wrap-up';

  const state = interviewSessionStateSchema.parse({
    version: 1,
    threadId: options.threadId,
    targetRole: kickoffConfig.targetRole,
    company: DEFAULT_COMPANY,
    responseLanguage: kickoffConfig.responseLanguage,
    phase,
    activeRoundId: startedFirstRound?.id ?? null,
    finalReportReady: false,
    finalReport: null,
    setup: {
      selectedDirection: kickoffConfig.selectedDirection,
      directionSource: kickoffConfig.directionSource,
      settings: kickoffConfig.settings,
    },
    resumeContext: {
      professionalSkills: options.professionalSkills,
      projectExperience: options.projectExperience,
      jobDescription: options.jobDescription,
      resumeParsed: options.professionalSkills.length > 0 || options.projectExperience.length > 0,
    },
    lastCorrectionSummary: null,
    rounds: updatedRounds,
  });

  return phase === 'wrap-up' ? finalizeInterview(state) : state;
}

function markFollowUpAnswered(node: InterviewTopicNodeState, answerAttemptId: string): InterviewTopicNodeState {
  return {
    ...node,
    followUps: node.followUps.map((followUp) =>
      followUp.id === node.currentFollowUpId
        ? {
            ...followUp,
            status: 'answered',
            linkedAnswerId: answerAttemptId,
          }
        : followUp,
    ),
  };
}

function shouldKeepFollowingUp(
  round: InterviewRoundState,
  node: InterviewTopicNodeState,
  evaluation: AnswerEvaluationResult,
): boolean {
  if (node.followUpCount >= node.maxFollowUps) {
    return false;
  }

  const guaranteedFollowUps = round.type === 'professional-skills' ? 2 : 1;
  if (node.followUpCount < guaranteedFollowUps) {
    return true;
  }

  if (!evaluation.score) {
    return node.followUpCount < node.maxFollowUps;
  }

  const hasOpenGaps = evaluation.missingPoints.length > 0 || evaluation.incorrectPoints.length > 0;
  if (!evaluation.shouldCompleteNode) {
    return node.followUpCount < node.maxFollowUps;
  }

  if (round.type === 'professional-skills') {
    if (node.followUpCount < node.maxFollowUps && (evaluation.score.weightedTotal < 8.2 || hasOpenGaps)) {
      return true;
    }

    return false;
  }

  if (node.followUpCount < node.maxFollowUps && evaluation.score.weightedTotal < 7.5 && hasOpenGaps) {
    return true;
  }

  return false;
}

function applyFollowUp(
  node: InterviewTopicNodeState,
  evaluation: AnswerEvaluationResult,
  language: ResponseLanguage,
  enableFlowTestMode: boolean,
): InterviewTopicNodeState {
  const nextFollowUp = node.followUps.find((followUp) => followUp.status === 'pending');
  if (!nextFollowUp) {
    return node;
  }

  const question = buildFollowUpQuestion({
    language,
    intent: evaluation.recommendedIntent,
    focus: evaluation.followUpFocus,
    node,
    followUpIndex: node.followUpCount + 1,
    enableFlowTestMode,
    generatedQuestion: evaluation.followUpQuestion,
  });

  return {
    ...node,
    status: 'awaiting-follow-up-answer',
    currentTargetType: 'follow-up',
    currentFollowUpId: nextFollowUp.id,
    followUpCount: node.followUpCount + 1,
    detourResponseCount: 0,
    followUps: node.followUps.map((followUp) =>
      followUp.id === nextFollowUp.id
        ? {
            ...followUp,
            intent: evaluation.recommendedIntent,
            question,
            status: 'asked',
          }
        : followUp,
    ),
  };
}

export function applyUserReply(options: {
  readonly state: InterviewSessionState;
  readonly userMessage: string;
  readonly evaluation: AnswerEvaluationResult;
}): ProcessAnswerResult {
  const resumedState = restoreInterviewProgressIfNeeded(options.state);

  if (resumedState.phase === 'completed' && resumedState.finalReport) {
    return {
      state: resumedState,
      assistantReply: resumedState.finalReport,
    };
  }

  if (options.evaluation.classification === 'stop-request') {
    if (countRemainingQuestionNodes(resumedState) > 0) {
      return {
        state: resumedState,
        assistantReply: buildPendingQuestionsGuardReply(resumedState),
      };
    }

    const finalState = finalizeInterview({
      ...resumedState,
      phase: 'wrap-up',
      activeRoundId: null,
    });

    return {
      state: finalState,
      assistantReply: finalState.finalReport ?? '',
    };
  }

  const round = getActiveRound(resumedState);
  const node = getActiveNode(round);

  if (!round || !node) {
    if (countRemainingQuestionNodes(resumedState) > 0) {
      return {
        state: resumedState,
        assistantReply: buildPendingQuestionsGuardReply(resumedState),
      };
    }

    const finalState = finalizeInterview({
      ...resumedState,
      phase: 'wrap-up',
      activeRoundId: null,
    });

    return {
      state: finalState,
      assistantReply: finalState.finalReport ?? '',
    };
  }

  const targetId = node.currentTargetType === 'main-question' ? node.id : node.currentFollowUpId ?? node.id;
  const answerAttempt = createAnswerAttempt({
    targetType: node.currentTargetType,
    targetId,
    userMessage: options.userMessage,
    evaluation: options.evaluation,
    isDetour: DETOUR_CLASSIFICATIONS.has(options.evaluation.classification),
  });
  let updatedNode: InterviewTopicNodeState = {
    ...node,
    answerAttempts: [...node.answerAttempts, answerAttempt],
  };

  if (options.evaluation.classification === 'clarification-request') {
    updatedNode = {
      ...updatedNode,
      detourResponseCount: 0,
    };
    const nextRound = updateNode(round, updatedNode);
    const nextState = updateRound(resumedState, nextRound);

    return {
      state: nextState,
      assistantReply: buildClarificationReply(nextState, updatedNode),
    };
  }

  if (options.evaluation.classification === 'skip-request') {
    updatedNode = summarizeNode({
      ...updatedNode,
      status: 'skipped',
      currentFollowUpId: null,
      currentTargetType: 'main-question',
      detourResponseCount: 0,
    }, resumedState.responseLanguage);
    const skippedRound = updateNode(round, compressCompletedNode(updatedNode));
    const advancedState = transitionAfterNode(resumedState, {
      ...skippedRound,
      completedNodeCount: skippedRound.nodes.filter((item) => item.status === 'completed').length,
    }, {
      ...updatedNode,
      status: 'completed',
    });

    if (advancedState.finalReportReady) {
      return {
        state: advancedState,
        assistantReply: advancedState.finalReport ?? '',
      };
    }

    return {
      state: advancedState,
      assistantReply: buildNextQuestionReply(advancedState, null),
    };
  }

  if (DETOUR_CLASSIFICATIONS.has(options.evaluation.classification)) {
    updatedNode = {
      ...updatedNode,
      status: 'detour-handling',
      detourResponseCount: node.detourResponseCount + 1,
    };

    const resumedNode: InterviewTopicNodeState = {
      ...updatedNode,
      status: node.currentTargetType === 'main-question' ? 'awaiting-main-answer' : 'awaiting-follow-up-answer',
    };
    const nextRound = updateNode(round, resumedNode);
    const nextState = updateRound(resumedState, nextRound);

    return {
      state: nextState,
      assistantReply: options.evaluation.detourReply ?? buildDetourReply(nextState, resumedNode),
    };
  }

  if (node.currentTargetType === 'follow-up') {
    updatedNode = markFollowUpAnswered(updatedNode, answerAttempt.id);
  }

  const shouldContinue = shouldKeepFollowingUp(round, updatedNode, options.evaluation);
  if (shouldContinue) {
    const nextNode = applyFollowUp(
      updatedNode,
      options.evaluation,
      resumedState.responseLanguage,
      resumedState.setup.settings.enableFlowTestMode,
    );
    const nextRound = updateNode(round, nextNode);
    const nextState = updateRound(resumedState, nextRound);

    return {
      state: nextState,
      assistantReply: buildNextQuestionReply(nextState, null),
    };
  }

  updatedNode = summarizeNode(
    {
      ...updatedNode,
      status: 'completed',
      earlyCompletionReason: options.evaluation.earlyCompletionReason,
      currentFollowUpId: null,
      currentTargetType: 'main-question',
      detourResponseCount: 0,
    },
    resumedState.responseLanguage,
  );
  const correctionSummary = resumedState.setup.settings.reviewIncorrectOrMissingPoints
    ? buildCorrectionSummary(updatedNode, resumedState.responseLanguage)
    : null;
  const transitionedState = transitionAfterNode(
    {
      ...resumedState,
      lastCorrectionSummary: correctionSummary,
    },
    round,
    updatedNode,
  );

  if (transitionedState.finalReportReady) {
    return {
      state: transitionedState,
      assistantReply: transitionedState.finalReport ?? '',
    };
  }

  return {
    state: transitionedState,
    assistantReply: buildNextQuestionReply(transitionedState, correctionSummary),
  };
}

export function validateInterviewState(state: unknown): InterviewSessionState {
  return interviewSessionStateSchema.parse(state);
}

export function sanitizeAnswerClassification(value: string): AnswerClassification {
  const parsed = answerClassificationSchema.safeParse(value);
  return parsed.success ? parsed.data : 'partial-answer';
}

export function sanitizeFollowUpIntent(value: string): FollowUpIntent {
  const parsed = followUpIntentSchema.safeParse(value);
  return parsed.success ? parsed.data : 'depth';
}