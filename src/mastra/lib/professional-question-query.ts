import { extractResumeTopics } from './interview-state-machine';
import type { ProfessionalQuestionLens, ProfessionalQuestionPlan } from './interview-question-planner';

function normalizeQueryFragment(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function splitContextLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter((line) => line.length > 0);
}

function extractSkillKeywords(skill: string): string[] {
  const normalizedSkill = normalizeQueryFragment(skill);
  const keywordCandidates = normalizedSkill
    .split(/[^a-z0-9\u3400-\u9fff+#.-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 || /[\u3400-\u9fff]/u.test(token));

  return [...new Set([normalizedSkill, ...keywordCandidates].filter((token) => token.length > 0))];
}

function extractRelevantProjectHighlights(projectExperience: string, skills: readonly string[]): string[] {
  const lines = splitContextLines(projectExperience);
  const normalizedSkills = skills
    .map((skill) => normalizeQueryFragment(skill))
    .filter((skill) => skill.length > 0);
  const keywords = [...new Set(skills.flatMap((skill) => extractSkillKeywords(skill)))];

  return lines.filter((line) => {
    const normalizedLine = normalizeQueryFragment(line);
    if (normalizedSkills.some((skill) => normalizedLine.includes(skill))) {
      return true;
    }

    return keywords.some((keyword) => normalizedLine.includes(keyword));
  });
}

export function describeProfessionalQuestionLens(lens: ProfessionalQuestionLens): string {
  switch (lens) {
    case 'trade-off-analysis':
      return 'trade-offs and architecture decisions';
    case 'failure-recovery':
      return 'failure handling, debugging, and recovery';
    case 'scalability':
      return 'performance, scalability, and production constraints';
    case 'cross-skill-integration':
      return 'cross-skill integration and end-to-end design';
    case 'delivery-prioritization':
      return 'delivery prioritization, collaboration, and execution';
    case 'implementation-depth':
    default:
      return 'implementation depth and reasoning';
  }
}

export function describeProfessionalPlanSkill(plan: ProfessionalQuestionPlan): string {
  if (plan.kind === 'skill-focus') {
    return plan.primarySkill;
  }

  if (plan.kind === 'cross-skill-scenario') {
    return `cross-skill:${plan.relatedSkills.join(' + ')}`;
  }

  return plan.relatedSkills.length > 0
    ? `broad-professional:${plan.relatedSkills.join(' + ')}`
    : 'broad-professional-context';
}

export function buildProfessionalSkillQuery(options: {
  readonly selectedDirection: string;
  readonly plan: ProfessionalQuestionPlan;
  readonly professionalSkills: string;
  readonly projectExperience: string;
}): string {
  const planSkills = options.plan.primarySkill
    ? [options.plan.primarySkill, ...options.plan.relatedSkills]
    : [...options.plan.relatedSkills];
  const excludedSkillKeys = new Set(planSkills.map((skill) => normalizeQueryFragment(skill)));
  const relatedSkills = extractResumeTopics(options.professionalSkills)
    .filter((skill) => !excludedSkillKeys.has(normalizeQueryFragment(skill)))
    .slice(0, 4);
  const relevantProjectHighlights = extractRelevantProjectHighlights(options.projectExperience, planSkills).slice(0, 2);
  const queryParts = [
    `Target role: ${options.selectedDirection}`,
    'Round type: professional-skills',
    `Question lens: ${describeProfessionalQuestionLens(options.plan.lens)}`,
  ];

  if (options.plan.kind === 'skill-focus') {
    queryParts.push(`Primary skill: ${options.plan.primarySkill}`);
  } else if (options.plan.kind === 'cross-skill-scenario') {
    queryParts.push(`Scenario skills: ${options.plan.relatedSkills.join(', ')}`);
    queryParts.push('Ask a harder scenario-based question that forces the candidate to connect these skills in one answer.');
  } else {
    queryParts.push('Use the broader professional skills context to ask a harder scenario-based question without repeating a single-skill explanation.');
  }

  if (relatedSkills.length > 0) {
    queryParts.push(`Related resume skills: ${relatedSkills.join(', ')}`);
  }

  if (relevantProjectHighlights.length > 0) {
    queryParts.push('Relevant project highlights:');
    queryParts.push(...relevantProjectHighlights.map((line) => `- ${line}`));
  }

  return queryParts.join('\n');
}