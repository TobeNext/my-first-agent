const MAX_EVALUATION_POINTS = 8;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeForMatch(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function uniqueNormalized(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    const key = normalizeForMatch(normalized);
    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function stripListMarker(value: string): string {
  return value
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*+•]\s*/, '')
    .replace(/^\d+[.)、]\s*/, '')
    .replace(/^[-–—]\s*/, '')
    .trim();
}

function splitReferenceAnswer(referenceAnswer: string): string[] {
  return referenceAnswer
    .split(/\r?\n|[。；;]\s*/u)
    .map(stripListMarker)
    .map(normalizeWhitespace)
    .filter((item) => item.length >= 4);
}

function extractMatchTokens(point: string): string[] {
  const normalizedPoint = normalizeForMatch(point);
  const tokens = normalizedPoint.match(/[a-z0-9+#.-]{3,}|[\p{Script=Han}]{2,}/gu) ?? [];
  const expandedTokens = tokens.flatMap((token) => {
    if (!/^[\p{Script=Han}]+$/u.test(token) || token.length <= 2) {
      return [token];
    }

    return [
      token,
      ...Array.from({ length: token.length - 1 }, (_, index) => token.slice(index, index + 2)),
    ];
  });

  return uniqueNormalized(expandedTokens).slice(0, 12);
}

function isPointCovered(point: string, userAnswer: string): boolean {
  const normalizedAnswer = normalizeForMatch(userAnswer);
  const normalizedPoint = normalizeForMatch(point);

  if (normalizedPoint.length > 0 && normalizedAnswer.includes(normalizedPoint)) {
    return true;
  }

  const tokens = extractMatchTokens(point);
  if (tokens.length === 0) {
    return false;
  }

  const matchedTokenCount = tokens.filter((token) => normalizedAnswer.includes(normalizeForMatch(token))).length;
  const requiredMatches = tokens.length >= 6 ? 2 : Math.min(3, Math.max(1, Math.ceil(tokens.length * 0.45)));

  return matchedTokenCount >= requiredMatches;
}

export function extractEvaluationPoints(referenceAnswer: string | null | undefined): string[] {
  if (!referenceAnswer?.trim()) {
    return [];
  }

  return uniqueNormalized(splitReferenceAnswer(referenceAnswer)).slice(0, MAX_EVALUATION_POINTS);
}

export function buildAnswerEvaluationPrompt(options: {
  readonly mainQuestion: string;
  readonly referenceAnswer: string;
  readonly evaluationPoints: readonly string[];
  readonly userAnswer: string;
}): string {
  return [
    'Evaluate the candidate answer against the reference answer points.',
    'Treat equivalent wording as covered; do not require exact phrase matching.',
    'Do not reveal the full reference answer to the candidate.',
    'Return JSON only with classification, score, strengths, missingPoints, incorrectPoints, shouldAskFollowUp, followUpFocus.',
    `Question: ${options.mainQuestion}`,
    `Reference answer points: ${options.evaluationPoints.join(' | ') || options.referenceAnswer}`,
    `Candidate answer: ${options.userAnswer}`,
    'Score relevance, accuracy, depth, specificity, and clarity from 0 to 10.',
  ].join('\n');
}

export function evaluateReferenceAnswerCoverage(options: {
  readonly referenceAnswer?: string | null;
  readonly evaluationPoints?: readonly string[] | null;
  readonly userAnswer: string;
}): {
  readonly hasReferenceAnswer: boolean;
  readonly coveredPoints: readonly string[];
  readonly missingPoints: readonly string[];
  readonly coverageRatio: number;
} {
  const points = uniqueNormalized([
    ...(options.evaluationPoints ?? []),
    ...extractEvaluationPoints(options.referenceAnswer),
  ]).slice(0, MAX_EVALUATION_POINTS);

  if (points.length === 0) {
    return {
      hasReferenceAnswer: false,
      coveredPoints: [],
      missingPoints: [],
      coverageRatio: 0,
    };
  }

  const coveredPoints = points.filter((point) => isPointCovered(point, options.userAnswer));
  const missingPoints = points.filter((point) => !coveredPoints.includes(point));

  return {
    hasReferenceAnswer: true,
    coveredPoints,
    missingPoints,
    coverageRatio: coveredPoints.length / points.length,
  };
}
