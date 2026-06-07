import {
  extractJobDescriptionMarkdownFromKickoffMessage,
  extractParsedResumeFromKickoffMessage,
  extractStructuredInterviewStartRequest,
} from './interview-kickoff-recovery';
import {
  type GenerateInitializationQuestionSetResult,
  generateInitializationQuestionSet,
} from './interview-question-generator';
import {
  type JudgeInitializationQuestionSetResult,
  judgeInitializationQuestionSet,
} from './interview-question-critic';
import {
  planProfessionalQuestionQueries,
  type ProfessionalQuestionPlan,
  type ProfessionalQuestionMode,
} from './interview-question-planner';
import {
  retrieveInitializationQuestions,
  type RetrieveInitializationQuestionsResult,
} from './interview-question-retriever';
import type { InterviewQuestionCandidate } from './interview-state-machine-schema';
import type { RagRecallTrace } from './rag-recall-sample';

export interface InterviewInitializationResources {
  readonly professionalSkills: string;
  readonly projectExperience: string;
  readonly normalizedProfessionalSkills: readonly string[];
  readonly normalizedProjectTopics: readonly string[];
  readonly jobDescription: string;
  readonly professionalQuestions: readonly InterviewQuestionCandidate[];
  readonly projectQuestions: readonly InterviewQuestionCandidate[];
  readonly generationTrace: GenerateInitializationQuestionSetResult['generationTrace'];
  readonly judgeTrace: JudgeInitializationQuestionSetResult['judgeTrace'];
  readonly recallTraces: readonly RagRecallTrace[];
}

interface PipelineDependencies {
  readonly planQuestions: (options: {
    readonly mode: ProfessionalQuestionMode;
    readonly professionalSkills: readonly string[];
    readonly desiredQuestionCount: number;
    readonly jobDescription?: string;
    readonly projectTopics?: readonly string[];
  }) => ProfessionalQuestionPlan[];
  readonly retrieveQuestions: (options: {
    readonly selectedDirection: string;
    readonly rawKickoffMessage: string;
    readonly professionalSkills: string;
    readonly normalizedProfessionalSkills: readonly string[];
    readonly projectExperience: string;
    readonly normalizedProjectTopics: readonly string[];
    readonly jobDescription: string;
    readonly professionalQuestionPlan: readonly ProfessionalQuestionPlan[];
  }) => Promise<RetrieveInitializationQuestionsResult>;
  readonly generateQuestions: (options: {
    readonly professionalQuestionPlan: readonly ProfessionalQuestionPlan[];
    readonly professionalQuestions: readonly InterviewQuestionCandidate[];
    readonly projectQuestions: readonly InterviewQuestionCandidate[];
    readonly jobDescription?: string;
    readonly normalizedProjectTopics?: readonly string[];
  }) => GenerateInitializationQuestionSetResult;
  readonly judgeQuestions: (options: {
    readonly professionalQuestionPlan: readonly ProfessionalQuestionPlan[];
    readonly professionalQuestions: readonly InterviewQuestionCandidate[];
    readonly projectQuestions: readonly InterviewQuestionCandidate[];
    readonly generationTrace: GenerateInitializationQuestionSetResult['generationTrace'];
    readonly normalizedProjectTopics: readonly string[];
  }) => JudgeInitializationQuestionSetResult;
}

function parseIntegerSetting(rawKickoffMessage: string, label: string, defaultValue: number): number {
  const pattern = new RegExp(`${label}:\\s*(\\d+)`, 'i');
  const match = rawKickoffMessage.match(pattern);
  if (!match) {
    return defaultValue;
  }

  const value = Number.parseInt(match[1], 10);
  return Number.isNaN(value) ? defaultValue : value;
}

function parseProfessionalQuestionMode(rawKickoffMessage: string): ProfessionalQuestionMode {
  const match = rawKickoffMessage.match(/Professional question mode:\s*(per-skill-default|custom-count)/i);
  return match?.[1]?.toLowerCase() === 'custom-count' ? 'custom-count' : 'per-skill-default';
}

function extractSelectedDirectionFromKickoffMessage(rawKickoffMessage: string): string {
  const selectedDirectionMatch = rawKickoffMessage.match(/Selected interview direction:\s*(.+)/i);
  const selectedDirection = selectedDirectionMatch?.[1]?.trim();
  if (selectedDirection && selectedDirection.toLowerCase() !== 'unknown') {
    return selectedDirection;
  }

  return /[\u3400-\u9fff]/.test(rawKickoffMessage) ? '通用技术岗位' : 'General Technical Role';
}

function recordFinalQuestionsByOriginalId(
  finalQuestionByOriginalId: Map<string, InterviewQuestionCandidate>,
  originalQuestions: readonly InterviewQuestionCandidate[],
  finalQuestions: readonly InterviewQuestionCandidate[],
): void {
  for (const [index, originalQuestion] of originalQuestions.entries()) {
    const finalQuestion = finalQuestions[index];
    if (finalQuestion) {
      finalQuestionByOriginalId.set(originalQuestion.id, finalQuestion);
    }
  }
}

function buildFinalQuestionByOriginalId(options: {
  readonly generatedQuestionSet: Pick<GenerateInitializationQuestionSetResult, 'professionalQuestions' | 'projectQuestions'>;
  readonly judgedQuestionSet: Pick<JudgeInitializationQuestionSetResult, 'professionalQuestions' | 'projectQuestions'>;
}): ReadonlyMap<string, InterviewQuestionCandidate> {
  const finalQuestionByOriginalId = new Map<string, InterviewQuestionCandidate>();

  recordFinalQuestionsByOriginalId(
    finalQuestionByOriginalId,
    options.generatedQuestionSet.professionalQuestions,
    options.judgedQuestionSet.professionalQuestions,
  );
  recordFinalQuestionsByOriginalId(
    finalQuestionByOriginalId,
    options.generatedQuestionSet.projectQuestions,
    options.judgedQuestionSet.projectQuestions,
  );

  return finalQuestionByOriginalId;
}

function alignGenerationTraceToFinalQuestions(options: {
  readonly generationTrace: GenerateInitializationQuestionSetResult['generationTrace'];
  readonly finalQuestionByOriginalId: ReadonlyMap<string, InterviewQuestionCandidate>;
}): GenerateInitializationQuestionSetResult['generationTrace'] {
  let hasChanges = false;

  const alignedGenerationTrace = options.generationTrace.map((record) => {
    const finalQuestion = options.finalQuestionByOriginalId.get(record.questionId);
    if (!finalQuestion) {
      return record;
    }

    if (finalQuestion.id === record.questionId && finalQuestion.text === record.questionText) {
      return record;
    }

    hasChanges = true;

    return {
      ...record,
      questionId: finalQuestion.id,
      questionText: finalQuestion.text,
    };
  });

  return hasChanges ? alignedGenerationTrace : options.generationTrace;
}

function alignRecallTracesToFinalQuestions(options: {
  readonly recallTraces: readonly RagRecallTrace[];
  readonly finalQuestionByOriginalId: ReadonlyMap<string, InterviewQuestionCandidate>;
}): readonly RagRecallTrace[] {
  return options.recallTraces.map((trace) => {
    let hasChanges = false;

    const candidates = trace.candidates.map((candidate) => {
      const finalQuestion = options.finalQuestionByOriginalId.get(candidate.id);
      if (!finalQuestion) {
        return candidate;
      }

      if (finalQuestion.id === candidate.id && finalQuestion.text === candidate.questionText) {
        return candidate;
      }

      hasChanges = true;

      return {
        ...candidate,
        id: finalQuestion.id,
        questionText: finalQuestion.text,
      };
    });
    const finalSelectedQuestions = trace.finalSelectedQuestions.map((selection) => {
      const finalQuestion = options.finalQuestionByOriginalId.get(selection.id);
      if (!finalQuestion) {
        return selection;
      }

      if (finalQuestion.id === selection.id && finalQuestion.text === selection.questionText) {
        return selection;
      }

      hasChanges = true;

      return {
        ...selection,
        id: finalQuestion.id,
        questionText: finalQuestion.text,
      };
    });

    if (!hasChanges) {
      return trace;
    }

    return {
      ...trace,
      candidateQuestionIds: candidates.map((candidate) => candidate.id),
      selectedQuestionIds: finalSelectedQuestions.map((selection) => selection.id),
      candidates,
      finalSelectedQuestions,
    };
  });
}

export async function resolveInterviewInitializationResources(
  rawKickoffMessage: string,
  deps: Partial<PipelineDependencies> = {},
): Promise<InterviewInitializationResources> {
  const runtimeDeps: PipelineDependencies = {
    planQuestions: deps.planQuestions ?? planProfessionalQuestionQueries,
    retrieveQuestions: deps.retrieveQuestions ?? retrieveInitializationQuestions,
    generateQuestions: deps.generateQuestions ?? generateInitializationQuestionSet,
    judgeQuestions: deps.judgeQuestions ?? judgeInitializationQuestionSet,
  };
  const structuredStartRequest = extractStructuredInterviewStartRequest(rawKickoffMessage);
  const parsedResume = extractParsedResumeFromKickoffMessage(rawKickoffMessage);
  const professionalSkills = parsedResume.professionalSkillsSection;
  const projectExperience = parsedResume.projectExperienceSection;
  const jobDescription = structuredStartRequest?.jobDescriptionMarkdown ?? extractJobDescriptionMarkdownFromKickoffMessage(rawKickoffMessage);
  const selectedDirection = extractSelectedDirectionFromKickoffMessage(rawKickoffMessage);
  const professionalQuestionMode = structuredStartRequest?.settings.professionalQuestionMode ?? parseProfessionalQuestionMode(rawKickoffMessage);
  const requestedProfessionalQuestionCount = structuredStartRequest?.settings.professionalQuestionCount ?? parseIntegerSetting(rawKickoffMessage, 'Professional question count', 0);
  const extractedProfessionalSkills = [...parsedResume.normalizedSkills];
  const desiredProfessionalQuestionCount =
    professionalQuestionMode === 'per-skill-default'
      ? extractedProfessionalSkills.length
      : requestedProfessionalQuestionCount;
  const professionalQuestionPlan = runtimeDeps.planQuestions({
    mode: professionalQuestionMode,
    professionalSkills: extractedProfessionalSkills,
    desiredQuestionCount: desiredProfessionalQuestionCount,
    jobDescription,
    projectTopics: parsedResume.normalizedProjectTopics,
  });
  const retrievalResult = await runtimeDeps.retrieveQuestions({
    selectedDirection,
    rawKickoffMessage,
    professionalSkills,
    normalizedProfessionalSkills: parsedResume.normalizedSkills,
    projectExperience,
    normalizedProjectTopics: parsedResume.normalizedProjectTopics,
    jobDescription,
    professionalQuestionPlan,
  });
  const generatedQuestionSet = runtimeDeps.generateQuestions({
    professionalQuestionPlan,
    professionalQuestions: retrievalResult.professionalQuestions,
    projectQuestions: retrievalResult.projectQuestions,
    jobDescription,
    normalizedProjectTopics: parsedResume.normalizedProjectTopics,
  });
  const judgedQuestionSet = runtimeDeps.judgeQuestions({
    professionalQuestionPlan,
    professionalQuestions: generatedQuestionSet.professionalQuestions,
    projectQuestions: generatedQuestionSet.projectQuestions,
    generationTrace: generatedQuestionSet.generationTrace,
    normalizedProjectTopics: parsedResume.normalizedProjectTopics,
  });
  const finalQuestionByOriginalId = buildFinalQuestionByOriginalId({
    generatedQuestionSet,
    judgedQuestionSet,
  });

  return {
    professionalSkills,
    projectExperience,
    normalizedProfessionalSkills: [...parsedResume.normalizedSkills],
    normalizedProjectTopics: [...parsedResume.normalizedProjectTopics],
    jobDescription,
    professionalQuestions: judgedQuestionSet.professionalQuestions,
    projectQuestions: judgedQuestionSet.projectQuestions,
    generationTrace: alignGenerationTraceToFinalQuestions({
      generationTrace: generatedQuestionSet.generationTrace,
      finalQuestionByOriginalId,
    }),
    judgeTrace: judgedQuestionSet.judgeTrace,
    recallTraces: alignRecallTracesToFinalQuestions({
      recallTraces: retrievalResult.recallTraces,
      finalQuestionByOriginalId,
    }),
  };
}