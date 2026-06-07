import type { GeneratedQuestionRecord } from './interview-question-generator';
import type { InterviewQuestionCandidate } from './interview-state-machine-schema';
import type { ProfessionalQuestionPlan } from './interview-question-planner';

export interface QuestionJudgeRecord {
  readonly roundType: 'professional-skills' | 'project-experience';
  readonly questionId: string;
  readonly originalQuestionText: string;
  readonly finalQuestionText: string;
  readonly verdict: 'accepted' | 'fallback';
  readonly failureReasons: readonly string[];
}

export interface JudgeInitializationQuestionSetOptions {
  readonly professionalQuestionPlan: readonly ProfessionalQuestionPlan[];
  readonly professionalQuestions: readonly InterviewQuestionCandidate[];
  readonly projectQuestions: readonly InterviewQuestionCandidate[];
  readonly generationTrace: readonly GeneratedQuestionRecord[];
  readonly normalizedProjectTopics: readonly string[];
}

export interface JudgeInitializationQuestionSetResult {
  readonly professionalQuestions: readonly InterviewQuestionCandidate[];
  readonly projectQuestions: readonly InterviewQuestionCandidate[];
  readonly judgeTrace: readonly QuestionJudgeRecord[];
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function includesAnyNormalized(text: string, signals: readonly string[]): boolean {
  const normalizedText = normalizeText(text);

  return signals.some((signal) => {
    const normalizedSignal = normalizeText(signal);
    return normalizedSignal.length > 0 && normalizedText.includes(normalizedSignal);
  });
}

function buildProfessionalFallbackQuestion(plan: ProfessionalQuestionPlan): string {
  if (plan.kind === 'skill-focus') {
    return `请结合你真实做过的项目，详细说明你在${plan.primarySkill}上的实现思路、关键取舍与排障经验。`;
  }

  const targetAbility = plan.relatedSkills.join('、') || '这些能力主题';

  return `请结合你真实做过的项目，说明你如何围绕${targetAbility}处理一个复杂场景，并解释关键取舍、限制和结果。`;
}

function buildProjectFallbackQuestion(normalizedProjectTopics: readonly string[]): string {
  const firstTopic = normalizedProjectTopics[0]?.trim();
  if (firstTopic) {
    return `请结合项目“${firstTopic}”，说明项目背景、你的职责、关键决策、遇到的挑战以及最终结果。`;
  }

  return '请结合一个你负责过的项目，说明项目背景、你的职责、关键决策、遇到的挑战以及最终结果。';
}

function replaceQuestion(question: InterviewQuestionCandidate, text: string, suffix: string): InterviewQuestionCandidate {
  return {
    ...question,
    id: `${question.id}:${suffix}`,
    text,
  };
}

function judgeProfessionalQuestion(options: {
  readonly question: InterviewQuestionCandidate;
  readonly plan: ProfessionalQuestionPlan | null;
  readonly seenQuestionTexts: Set<string>;
}): {
  readonly question: InterviewQuestionCandidate;
  readonly judgeRecord: QuestionJudgeRecord;
} {
  const failureReasons: string[] = [];
  const normalizedQuestionText = normalizeText(options.question.text);

  if (normalizedQuestionText.length < 8) {
    failureReasons.push('question-too-short');
  }

  if (normalizedQuestionText.length > 0 && options.seenQuestionTexts.has(normalizedQuestionText)) {
    failureReasons.push('duplicate-question');
  }

  if (options.plan) {
    if (
      options.plan.questionType === 'scenario' &&
      !includesAnyNormalized(options.question.text, ['如何', '场景', '设计', '取舍', '结合', 'scenario'])
    ) {
      failureReasons.push('scenario-shape-mismatch');
    }
  }

  const accepted = failureReasons.length === 0;
  const finalQuestion = accepted
    ? options.question
    : replaceQuestion(
        options.question,
        options.plan
          ? buildProfessionalFallbackQuestion(options.plan)
          : '请结合你真实做过的项目，详细说明你最熟悉的一项专业能力是如何落地、排障和优化的。',
        'critic-fallback',
      );
  const finalNormalizedText = normalizeText(finalQuestion.text);
  if (finalNormalizedText.length > 0) {
    options.seenQuestionTexts.add(finalNormalizedText);
  }

  return {
    question: finalQuestion,
    judgeRecord: {
      roundType: 'professional-skills',
      questionId: options.question.id,
      originalQuestionText: options.question.text,
      finalQuestionText: finalQuestion.text,
      verdict: accepted ? 'accepted' : 'fallback',
      failureReasons,
    },
  };
}

function judgeProjectQuestion(options: {
  readonly question: InterviewQuestionCandidate;
  readonly normalizedProjectTopics: readonly string[];
  readonly seenQuestionTexts: Set<string>;
}): {
  readonly question: InterviewQuestionCandidate;
  readonly judgeRecord: QuestionJudgeRecord;
} {
  const failureReasons: string[] = [];
  const normalizedQuestionText = normalizeText(options.question.text);

  if (normalizedQuestionText.length < 8) {
    failureReasons.push('question-too-short');
  }

  if (normalizedQuestionText.length > 0 && options.seenQuestionTexts.has(normalizedQuestionText)) {
    failureReasons.push('duplicate-question');
  }

  if (!includesAnyNormalized(options.question.text, ['项目', 'project', '经历', '负责'])) {
    failureReasons.push('project-shape-mismatch');
  }

  const accepted = failureReasons.length === 0;
  const finalQuestion = accepted
    ? options.question
    : replaceQuestion(options.question, buildProjectFallbackQuestion(options.normalizedProjectTopics), 'critic-fallback');
  const finalNormalizedText = normalizeText(finalQuestion.text);
  if (finalNormalizedText.length > 0) {
    options.seenQuestionTexts.add(finalNormalizedText);
  }

  return {
    question: finalQuestion,
    judgeRecord: {
      roundType: 'project-experience',
      questionId: options.question.id,
      originalQuestionText: options.question.text,
      finalQuestionText: finalQuestion.text,
      verdict: accepted ? 'accepted' : 'fallback',
      failureReasons,
    },
  };
}

export function judgeInitializationQuestionSet(
  options: JudgeInitializationQuestionSetOptions,
): JudgeInitializationQuestionSetResult {
  const seenQuestionTexts = new Set<string>();
  const professionalQuestions = options.professionalQuestions.map((question, index) => {
    const result = judgeProfessionalQuestion({
      question,
      plan: options.professionalQuestionPlan[index] ?? null,
      seenQuestionTexts,
    });

    return result;
  });
  const projectQuestions = options.projectQuestions.map((question) => {
    const result = judgeProjectQuestion({
      question,
      normalizedProjectTopics: options.normalizedProjectTopics,
      seenQuestionTexts,
    });

    return result;
  });

  return {
    professionalQuestions: professionalQuestions.map((item) => item.question),
    projectQuestions: projectQuestions.map((item) => item.question),
    judgeTrace: [
      ...professionalQuestions.map((item) => item.judgeRecord),
      ...projectQuestions.map((item) => item.judgeRecord),
    ],
  };
}