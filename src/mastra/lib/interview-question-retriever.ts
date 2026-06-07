import type { InterviewQuestionCandidate, RoundType } from './interview-state-machine-schema';
import type { ProfessionalQuestionPlan } from './interview-question-planner';
import {
  buildProfessionalSkillQuery,
  describeProfessionalPlanSkill,
} from './professional-question-query';
import { buildProjectExperienceQuery } from './project-question-query';
import type { RagRecallTrace } from './rag-recall-sample';
import {
  queryInterviewQuestions,
  type QueryInterviewQuestionsOptions,
  type QueryInterviewQuestionsResult,
} from '../tools/interview-question-tool';

interface QueryContextOptions {
  readonly selectedDirection: string;
  readonly roundType: RoundType;
  readonly sectionContent: string;
  readonly rawKickoffMessage: string;
}

export interface RetrieveInitializationQuestionsOptions {
  readonly selectedDirection: string;
  readonly rawKickoffMessage: string;
  readonly professionalSkills: string;
  readonly normalizedProfessionalSkills: readonly string[];
  readonly projectExperience: string;
  readonly normalizedProjectTopics: readonly string[];
  readonly jobDescription: string;
  readonly professionalQuestionPlan: readonly ProfessionalQuestionPlan[];
}

export interface RetrieveInitializationQuestionsResult {
  readonly professionalQuestions: readonly InterviewQuestionCandidate[];
  readonly projectQuestions: readonly InterviewQuestionCandidate[];
  readonly recallTraces: readonly RagRecallTrace[];
}

interface RetrieverDependencies {
  readonly queryQuestions: (
    options: QueryInterviewQuestionsOptions,
  ) => Promise<QueryInterviewQuestionsResult>;
}

function buildRoundContextQuery(options: QueryContextOptions): string {
  const sectionHeading = options.roundType === 'professional-skills' ? 'Professional skills' : 'Project experience';
  const fallbackContext = options.sectionContent.trim() || options.rawKickoffMessage;

  return [
    `Target role: ${options.selectedDirection}`,
    `Round type: ${options.roundType}`,
    `${sectionHeading} context:`,
    fallbackContext,
  ].join('\n');
}

function createRecallTraceCollector(recallTraces: RagRecallTrace[]): (trace: RagRecallTrace) => void {
  return (trace) => {
    recallTraces.push(trace);
  };
}

function combineQuestionQueryResults(results: readonly QueryInterviewQuestionsResult[]): QueryInterviewQuestionsResult {
  return {
    count: results.reduce((total, result) => total + result.count, 0),
    questions: results.flatMap((result) => result.questions),
  };
}

async function retrieveProfessionalQuestions(
  options: RetrieveInitializationQuestionsOptions & {
    readonly onRecallTrace: (trace: RagRecallTrace) => void;
  },
  deps: RetrieverDependencies,
): Promise<QueryInterviewQuestionsResult> {
  if (options.professionalQuestionPlan.length === 0) {
    return deps.queryQuestions({
      queryText: buildRoundContextQuery({
        selectedDirection: options.selectedDirection,
        roundType: 'professional-skills',
        sectionContent: options.professionalSkills,
        rawKickoffMessage: options.rawKickoffMessage,
      }),
      topK: 10,
      roundType: 'professional-skills',
      skill: 'professional-skills-context',
      logContext: 'initialization:professional-skills:context',
      onRecallTrace: options.onRecallTrace,
    });
  }

  const results = await Promise.all(
    options.professionalQuestionPlan.map((plan) =>
      deps.queryQuestions({
        queryText: buildProfessionalSkillQuery({
          selectedDirection: options.selectedDirection,
          plan,
          professionalSkills: options.professionalSkills,
          normalizedSkills: options.normalizedProfessionalSkills,
          projectExperience: options.projectExperience,
        }),
        topK: 1,
        roundType: 'professional-skills',
        skill: describeProfessionalPlanSkill(plan),
        logContext: `initialization:professional-skills:${describeProfessionalPlanSkill(plan)}`,
        onRecallTrace: options.onRecallTrace,
      }),
    ),
  );

  return combineQuestionQueryResults(results);
}

async function retrieveProjectQuestions(
  options: Pick<
    RetrieveInitializationQuestionsOptions,
    'selectedDirection' | 'projectExperience' | 'rawKickoffMessage' | 'normalizedProjectTopics' | 'jobDescription'
  > & {
    readonly onRecallTrace: (trace: RagRecallTrace) => void;
  },
  deps: RetrieverDependencies,
): Promise<QueryInterviewQuestionsResult> {
  return deps.queryQuestions({
    queryText: buildProjectExperienceQuery({
      selectedDirection: options.selectedDirection,
      projectExperience: options.projectExperience,
      rawKickoffMessage: options.rawKickoffMessage,
      normalizedProjectTopics: options.normalizedProjectTopics,
      jobDescription: options.jobDescription,
    }),
    topK: 10,
    roundType: 'project-experience',
    skill: 'project-experience-context',
    logContext: 'initialization:project-experience:context',
    onRecallTrace: options.onRecallTrace,
  });
}

export async function retrieveInitializationQuestions(
  options: RetrieveInitializationQuestionsOptions,
  deps: Partial<RetrieverDependencies> = {},
): Promise<RetrieveInitializationQuestionsResult> {
  const runtimeDeps: RetrieverDependencies = {
    queryQuestions: deps.queryQuestions ?? queryInterviewQuestions,
  };
  const recallTraces: RagRecallTrace[] = [];
  const onRecallTrace = createRecallTraceCollector(recallTraces);

  const [professionalQueryResult, projectQueryResult] = await Promise.all([
    retrieveProfessionalQuestions(
      {
        ...options,
        onRecallTrace,
      },
      runtimeDeps,
    ),
    retrieveProjectQuestions(
      {
        selectedDirection: options.selectedDirection,
        projectExperience: options.projectExperience,
        rawKickoffMessage: options.rawKickoffMessage,
        normalizedProjectTopics: options.normalizedProjectTopics,
        jobDescription: options.jobDescription,
        onRecallTrace,
      },
      runtimeDeps,
    ),
  ]);

  return {
    professionalQuestions: professionalQueryResult.questions,
    projectQuestions: projectQueryResult.questions,
    recallTraces,
  };
}