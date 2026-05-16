export type ProfessionalQuestionMode = 'per-skill-default' | 'custom-count';

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
}

export interface CrossSkillScenarioQuestionPlan {
  readonly kind: 'cross-skill-scenario';
  readonly primarySkill: null;
  readonly relatedSkills: readonly string[];
  readonly lens: Exclude<ProfessionalQuestionLens, 'implementation-depth'>;
}

export interface BroadProfessionalScenarioQuestionPlan {
  readonly kind: 'broad-professional-scenario';
  readonly primarySkill: null;
  readonly relatedSkills: readonly string[];
  readonly lens: Exclude<ProfessionalQuestionLens, 'implementation-depth'>;
}

export type ProfessionalQuestionPlan =
  | SkillFocusQuestionPlan
  | CrossSkillScenarioQuestionPlan
  | BroadProfessionalScenarioQuestionPlan;

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

export function planProfessionalQuestionQueries(options: {
  readonly mode: ProfessionalQuestionMode;
  readonly professionalSkills: readonly string[];
  readonly desiredQuestionCount: number;
}): ProfessionalQuestionPlan[] {
  const normalizedSkills = uniqueSkills(options.professionalSkills);
  if (normalizedSkills.length === 0 || options.desiredQuestionCount <= 0) {
    return [];
  }

  if (options.mode === 'per-skill-default') {
    return normalizedSkills.slice(0, options.desiredQuestionCount).map((skill) => ({
      kind: 'skill-focus',
      primarySkill: skill,
      relatedSkills: [],
      lens: 'implementation-depth',
    }));
  }

  const shuffledSkills = shuffle(normalizedSkills);
  const uniqueSkillPlans = shuffledSkills
    .slice(0, Math.min(options.desiredQuestionCount, shuffledSkills.length))
    .map<SkillFocusQuestionPlan>((skill) => ({
      kind: 'skill-focus',
      primarySkill: skill,
      relatedSkills: [],
      lens: 'implementation-depth',
    }));

  const overflowCount = Math.max(0, options.desiredQuestionCount - uniqueSkillPlans.length);
  const overflowPlans = Array.from({ length: overflowCount }, (_, overflowIndex) => {
    const lens = OVERFLOW_LENSES[overflowIndex % OVERFLOW_LENSES.length];
    if (shuffledSkills.length >= 2) {
      return {
        kind: 'cross-skill-scenario',
        primarySkill: null,
        relatedSkills: buildCrossSkillGroup(shuffledSkills, overflowIndex),
        lens,
      } satisfies CrossSkillScenarioQuestionPlan;
    }

    return {
      kind: 'broad-professional-scenario',
      primarySkill: null,
      relatedSkills: shuffledSkills,
      lens,
    } satisfies BroadProfessionalScenarioQuestionPlan;
  });

  return [...uniqueSkillPlans, ...overflowPlans];
}