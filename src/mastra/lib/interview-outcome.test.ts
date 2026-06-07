import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createInterviewOutcomeSnapshot } from './interview-outcome';
import { interviewSessionStateSchema } from './interview-state-machine-schema';

const createdDirectories: string[] = [];

afterEach(async () => {
  const currentDirectory = createdDirectories.pop();
  if (currentDirectory) {
    await rm(currentDirectory, { recursive: true, force: true });
  }
});

describe('createInterviewOutcomeSnapshot', () => {
  it('persists question driver and trigger signals into the outcome file', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'jd-outcome-'));
    createdDirectories.push(workspaceRoot);
    await writeFile(join(workspaceRoot, 'package.json'), '{"name":"tmp"}\n', 'utf-8');
    await mkdir(join(workspaceRoot, 'src'), { recursive: true });
    await writeFile(join(workspaceRoot, 'src', '.gitkeep'), '', 'utf-8');
    const previousCwd = process.cwd();
    process.chdir(workspaceRoot);

    try {
      const state = interviewSessionStateSchema.parse({
        version: 1,
        threadId: 'thread-outcome',
        targetRole: 'AI Agent Engineer',
        company: null,
        responseLanguage: 'zh',
        phase: 'professional-skills-round',
        activeRoundId: 'round-1',
        finalReportReady: false,
        finalReport: null,
        setup: {
          selectedDirection: 'AI Agent Engineer',
          directionSource: 'preset',
          settings: {
            reviewIncorrectOrMissingPoints: true,
            skipProfessionalSkillsRound: false,
            skipProjectExperienceRound: false,
            enableFlowTestMode: false,
            professionalQuestionMode: 'custom-count',
            professionalQuestionCount: 1,
            projectQuestionCount: 1,
          },
        },
        resumeContext: {
          professionalSkills: 'TypeScript',
          projectExperience: 'AI Agent 面试系统',
          jobDescription: 'Build reliable agent systems',
          resumeParsed: true,
        },
        lastCorrectionSummary: null,
        rounds: [
          {
            id: 'round-1',
            type: 'professional-skills',
            status: 'completed',
            plannedNodeCount: 1,
            completedNodeCount: 1,
            activeNodeId: null,
            nodeOrder: ['node-1'],
            nodes: [
              {
                id: 'node-1',
                topic: 'TypeScript',
                source: 'knowledge-base',
                mainQuestion: '请说明 TypeScript 在大型项目中的类型边界设计。',
                status: 'completed',
                currentTargetType: 'main-question',
                currentFollowUpId: null,
                followUpCount: 0,
                maxFollowUps: 3,
                detourResponseCount: 0,
                earlyCompletionReason: null,
                followUps: [],
                answerAttempts: [],
                aggregatedScore: 8.6,
                summary: {
                  strengths: ['边界拆分清晰'],
                  weaknesses: [],
                  missingPoints: [],
                  improvementAdvice: ['补充 DTO 与领域对象的约束方式'],
                  evidence: ['提到了接口层与领域层拆分'],
                },
              },
            ],
          },
        ],
      });

      const filePath = await createInterviewOutcomeSnapshot({
        threadId: state.threadId,
        state,
        recallTraces: [],
        generationTrace: [
          {
            roundType: 'professional-skills',
            source: 'retrieved',
            targetAbility: 'TypeScript',
            questionType: 'knowledge-check',
            coverageIntent: 'implementation-depth',
            questionDriver: 'resume-and-job-description',
            resumeSignals: ['TypeScript'],
            jobDescriptionSignals: ['Build reliable agent systems'],
            expectedDifficulty: 'medium',
            questionId: 'p-1',
            questionText: '请说明 TypeScript 在大型项目中的类型边界设计。',
            selectionReason: 'Selected TypeScript and cross-checked it against JD requirements.',
          },
        ],
      });

      const record = JSON.parse(await readFile(filePath, 'utf-8')) as {
        selectorTraining: { generationTrace: Array<{ questionDriver: string }> };
        candidateImprovement: {
          questionReviews: Array<{
            questionDriver: string;
            jobDescriptionSignals: string[];
            selectionReason: string;
          }>;
        };
      };

      expect(record.selectorTraining.generationTrace[0]?.questionDriver).toBe('resume-and-job-description');
      expect(record.candidateImprovement.questionReviews[0]?.questionDriver).toBe('resume-and-job-description');
      expect(record.candidateImprovement.questionReviews[0]?.jobDescriptionSignals).toContain('Build reliable agent systems');
      expect(record.candidateImprovement.questionReviews[0]?.selectionReason).toContain('cross-checked');
    } finally {
      process.chdir(previousCwd);
    }
  });
});