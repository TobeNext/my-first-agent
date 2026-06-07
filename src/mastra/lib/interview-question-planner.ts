import {
  extractJobDescriptionSignalSet,
  resolveQuestionDriver,
  type QuestionDriver,
} from './job-description-signals';

export type ProfessionalQuestionMode = 'per-skill-default' | 'custom-count';

export type PlannedQuestionType = 'knowledge-check' | 'scenario';

export type PlannedQuestionDifficulty = 'medium' | 'hard';

export type ProfessionalQuestionLens =
  | 'implementation-depth'
  | 'trade-off-analysis'
  | 'failure-recovery'
  | 'scalability'
  | 'cross-skill-integration'
  | 'delivery-prioritization';

export interface SkillFocusQuestionPlan {
  readonly kind: 'skill-focus';
  readonly primarySkill: string;
  readonly relatedSkills: readonly string[];
  readonly lens: 'implementation-depth';
  readonly targetAbility: string;
  readonly questionType: PlannedQuestionType;
  readonly coverageIntent: ProfessionalQuestionLens;
  readonly resumeSignals: readonly string[];
  readonly jobDescriptionSignals: readonly string[];
  readonly questionDriver: QuestionDriver;
  readonly expectedDifficulty: PlannedQuestionDifficulty;
  readonly selectionReason: string;
}

export interface CrossSkillScenarioQuestionPlan {
  readonly kind: 'cross-skill-scenario';
  readonly primarySkill: null;
  readonly relatedSkills: readonly string[];
  readonly lens: Exclude<ProfessionalQuestionLens, 'implementation-depth'>;
  readonly targetAbility: string;
  readonly questionType: PlannedQuestionType;
  readonly coverageIntent: ProfessionalQuestionLens;
  readonly resumeSignals: readonly string[];
  readonly jobDescriptionSignals: readonly string[];
  readonly questionDriver: QuestionDriver;
  readonly expectedDifficulty: PlannedQuestionDifficulty;
  readonly selectionReason: string;
}

export interface BroadProfessionalScenarioQuestionPlan {
  readonly kind: 'broad-professional-scenario';
  readonly primarySkill: null;
  readonly relatedSkills: readonly string[];
  readonly lens: Exclude<ProfessionalQuestionLens, 'implementation-depth'>;
  readonly targetAbility: string;
  readonly questionType: PlannedQuestionType;
  readonly coverageIntent: ProfessionalQuestionLens;
  readonly resumeSignals: readonly string[];
  readonly jobDescriptionSignals: readonly string[];
  readonly questionDriver: QuestionDriver;
  readonly expectedDifficulty: PlannedQuestionDifficulty;
  readonly selectionReason: string;
}

export interface JobDescriptionGapQuestionPlan {
  readonly kind: 'jd-gap-scenario';
  readonly primarySkill: null;
  readonly relatedSkills: readonly string[];
  readonly lens: Exclude<ProfessionalQuestionLens, 'implementation-depth'>;
  readonly targetAbility: string;
  readonly questionType: PlannedQuestionType;
  readonly coverageIntent: ProfessionalQuestionLens;
  readonly resumeSignals: readonly string[];
  readonly jobDescriptionSignals: readonly string[];
  readonly questionDriver: QuestionDriver;
  readonly expectedDifficulty: PlannedQuestionDifficulty;
  readonly selectionReason: string;
}

export type ProfessionalQuestionPlan =
  | SkillFocusQuestionPlan
  | CrossSkillScenarioQuestionPlan
  | BroadProfessionalScenarioQuestionPlan
  | JobDescriptionGapQuestionPlan;

const OVERFLOW_LENSES: readonly Exclude<ProfessionalQuestionLens, 'implementation-depth'>[] = [
  'trade-off-analysis',
  'failure-recovery',
  'scalability',
  'cross-skill-integration',
  'delivery-prioritization',
];

function normalizeSkill(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function uniqueSkills(skills: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const skill of skills) {
    const normalized = normalizeSkill(skill);
    const dedupeKey = normalized.toLowerCase();
    if (!normalized || seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    result.push(normalized);
  }

  return result;
}

function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function buildCrossSkillGroup(skills: readonly string[], overflowIndex: number): string[] {
  const startIndex = overflowIndex % skills.length;
  const rotatedSkills = [...skills.slice(startIndex), ...skills.slice(0, startIndex)];
  const preferredGroupSize = skills.length >= 3 && overflowIndex % 2 === 1 ? 3 : 2;

  return rotatedSkills.slice(0, Math.min(preferredGroupSize, skills.length));
}

function buildSkillFocusSelectionReason(options: {
  readonly skill: string;
  readonly mode: ProfessionalQuestionMode;
  readonly matchedJobDescriptionSignals: readonly string[];
}): string {
  if (options.matchedJobDescriptionSignals.length > 0) {
    const signalSummary = options.matchedJobDescriptionSignals.join(' | ');

    if (options.mode === 'per-skill-default') {
      return `Selected ${options.skill} as the canonical resume skill owner and cross-checked it against JD signals: ${signalSummary}.`;
    }

    return `Selected ${options.skill} as a unique primary skill before overflow allocation because it intersects JD signals: ${signalSummary}.`;
  }

  if (options.mode === 'per-skill-default') {
    return `Selected ${options.skill} as the canonical resume skill owner for one dedicated implementation-depth question.`;
  }

  return `Selected ${options.skill} as a unique primary skill before allocating overflow slots to harder scenario coverage.`;
}

function buildScenarioSelectionReason(
  kind: 'cross-skill-scenario' | 'broad-professional-scenario',
  relatedSkills: readonly string[],
  lens: ProfessionalQuestionLens,
): string {
  const skillSummary = relatedSkills.length > 0 ? relatedSkills.join(', ') : 'the broader resume context';

  if (kind === 'cross-skill-scenario') {
    return `Selected a ${lens} scenario to verify how the candidate connects ${skillSummary} in one answer without repeating a single-skill explanation.`;
  }

  return `Selected a broader ${lens} scenario to stretch beyond the single available skill signal and keep coverage diverse.`;
}

export function planProfessionalQuestionQueries(options: {
  readonly mode: ProfessionalQuestionMode;
  readonly professionalSkills: readonly string[];
  readonly desiredQuestionCount: number;
  readonly jobDescription?: string;
  readonly projectTopics?: readonly string[];
}): ProfessionalQuestionPlan[] {
  const normalizedSkills = uniqueSkills(options.professionalSkills);
  if (normalizedSkills.length === 0 || options.desiredQuestionCount <= 0) {
    return [];
  }

  const jobDescriptionSignalSet = extractJobDescriptionSignalSet({
    jobDescription: options.jobDescription,
    resumeTopics: normalizedSkills,
    projectTopics: options.projectTopics,
  });

  function resolveMatchedSignals(skill: string): string[] {
    const normalizedSkill = skill.toLowerCase();
    return jobDescriptionSignalSet.topSignals.filter((signal) => {
      const normalizedSignal = signal.toLowerCase();
      return normalizedSignal.includes(normalizedSkill) || normalizedSkill.includes(normalizedSignal);
    });
  }

  if (options.mode === 'per-skill-default') {
    return normalizedSkills.slice(0, options.desiredQuestionCount).map((skill) => {
      const matchedSignals = resolveMatchedSignals(skill);

      return {
        kind: 'skill-focus',
        primarySkill: skill,
        relatedSkills: [],
        lens: 'implementation-depth',
        targetAbility: skill,
        questionType: 'knowledge-check',
        coverageIntent: 'implementation-depth',
        resumeSignals: [skill],
        jobDescriptionSignals: matchedSignals,
        questionDriver: resolveQuestionDriver({
          hasResumeSignals: true,
          hasJobDescriptionSignals: matchedSignals.length > 0,
        }),
        expectedDifficulty: 'medium',
        selectionReason: buildSkillFocusSelectionReason({
          skill,
          mode: options.mode,
          matchedJobDescriptionSignals: matchedSignals,
        }),
      } satisfies SkillFocusQuestionPlan;
    });
  }

  const shuffledSkills = shuffle(normalizedSkills);
  const uniqueSkillPlans = shuffledSkills
    .slice(0, Math.min(options.desiredQuestionCount, shuffledSkills.length))
    .map<SkillFocusQuestionPlan>((skill) => {
      const matchedSignals = resolveMatchedSignals(skill);

      return {
        kind: 'skill-focus',
        primarySkill: skill,
        relatedSkills: [],
        lens: 'implementation-depth',
        targetAbility: skill,
        questionType: 'knowledge-check',
        coverageIntent: 'implementation-depth',
        resumeSignals: [skill],
        jobDescriptionSignals: matchedSignals,
        questionDriver: resolveQuestionDriver({
          hasResumeSignals: true,
          hasJobDescriptionSignals: matchedSignals.length > 0,
        }),
        expectedDifficulty: 'medium',
        selectionReason: buildSkillFocusSelectionReason({
          skill,
          mode: options.mode,
          matchedJobDescriptionSignals: matchedSignals,
        }),
      };
    });

  const overflowCount = Math.max(0, options.desiredQuestionCount - uniqueSkillPlans.length);
  const gapSignals = jobDescriptionSignalSet.gapSignals.slice(0, overflowCount);
  const gapPlans = gapSignals.map<JobDescriptionGapQuestionPlan>((gapSignal, overflowIndex) => {
    const lens = OVERFLOW_LENSES[overflowIndex % OVERFLOW_LENSES.length];
    const relatedSkills = buildCrossSkillGroup(shuffledSkills, overflowIndex);

    return {
      kind: 'jd-gap-scenario',
      primarySkill: null,
      relatedSkills,
      lens,
      targetAbility: gapSignal,
      questionType: 'scenario',
      coverageIntent: lens,
      resumeSignals: relatedSkills,
      jobDescriptionSignals: [gapSignal],
      questionDriver: 'job-description',
      expectedDifficulty: 'hard',
      selectionReason: `Selected JD-only capability gap "${gapSignal}" to validate a requirement that is not clearly evidenced in the resume.`,
    };
  });
  const remainingOverflowCount = Math.max(0, overflowCount - gapPlans.length);
  const overflowPlans = Array.from({ length: remainingOverflowCount }, (_, overflowIndex) => {
    const lens = OVERFLOW_LENSES[overflowIndex % OVERFLOW_LENSES.length];
    if (shuffledSkills.length >= 2) {
      const relatedSkills = buildCrossSkillGroup(shuffledSkills, overflowIndex);
      const matchedSignals = jobDescriptionSignalSet.alignedSignals.slice(0, 2);

      return {
        kind: 'cross-skill-scenario',
        primarySkill: null,
        relatedSkills,
        lens,
        targetAbility: relatedSkills.join(' + '),
        questionType: 'scenario',
        coverageIntent: lens,
        resumeSignals: relatedSkills,
        jobDescriptionSignals: matchedSignals,
        questionDriver: resolveQuestionDriver({
          hasResumeSignals: relatedSkills.length > 0,
          hasJobDescriptionSignals: matchedSignals.length > 0,
        }),
        expectedDifficulty: 'hard',
        selectionReason: buildScenarioSelectionReason(
          'cross-skill-scenario',
          relatedSkills,
          lens,
        ),
      } satisfies CrossSkillScenarioQuestionPlan;
    }

    return {
      kind: 'broad-professional-scenario',
      primarySkill: null,
      relatedSkills: shuffledSkills,
      lens,
      targetAbility: shuffledSkills.join(' + '),
      questionType: 'scenario',
      coverageIntent: lens,
      resumeSignals: shuffledSkills,
      jobDescriptionSignals: jobDescriptionSignalSet.alignedSignals.slice(0, 2),
      questionDriver: resolveQuestionDriver({
        hasResumeSignals: shuffledSkills.length > 0,
        hasJobDescriptionSignals: jobDescriptionSignalSet.alignedSignals.length > 0,
      }),
      expectedDifficulty: 'hard',
      selectionReason: buildScenarioSelectionReason('broad-professional-scenario', shuffledSkills, lens),
    } satisfies BroadProfessionalScenarioQuestionPlan;
  });

  return [...uniqueSkillPlans, ...gapPlans, ...overflowPlans];
}