import { describe, expect, it } from 'vitest';

import {
  buildAnswerEvaluationPrompt,
  evaluateReferenceAnswerCoverage,
  extractEvaluationPoints,
} from './interview-answer-evaluation';

describe('interview answer evaluation helpers', () => {
  it('extracts reference answer points from mixed bullet and sentence text', () => {
    expect(
      extractEvaluationPoints([
        '- 明确 Spring Bean 生命周期',
        '- 说明 AOP 代理创建时机',
        '需要补充事务传播和异常回滚。',
      ].join('\n')),
    ).toEqual([
      '明确 Spring Bean 生命周期',
      '说明 AOP 代理创建时机',
      '需要补充事务传播和异常回滚',
    ]);
  });

  it('detects covered and missing reference answer points without exact phrase matching', () => {
    const result = evaluateReferenceAnswerCoverage({
      referenceAnswer: [
        '- 说明 Spring Bean 生命周期',
        '- 解释事务传播机制',
        '- 补充异常回滚边界',
      ].join('\n'),
      userAnswer: '我会先讲 Bean 生命周期，包括实例化、初始化和销毁阶段；然后说明事务传播在调用链里的影响。',
    });

    expect(result.hasReferenceAnswer).toBe(true);
    expect(result.coveredPoints).toEqual([
      '说明 Spring Bean 生命周期',
      '解释事务传播机制',
    ]);
    expect(result.missingPoints).toEqual(['补充异常回滚边界']);
    expect(result.coverageRatio).toBeCloseTo(2 / 3);
  });

  it('builds the answer evaluation prompt contract without candidate-facing leakage behavior', () => {
    const prompt = buildAnswerEvaluationPrompt({
      mainQuestion: 'Spring 事务传播怎么处理？',
      referenceAnswer: '说明事务传播机制；补充异常回滚边界。',
      evaluationPoints: ['说明事务传播机制', '补充异常回滚边界'],
      userAnswer: '我会说明 REQUIRED 和 REQUIRES_NEW 的区别。',
    });

    expect(prompt).toContain('Return JSON only');
    expect(prompt).toContain('Treat equivalent wording as covered');
    expect(prompt).toContain('Reference answer points: 说明事务传播机制 | 补充异常回滚边界');
    expect(prompt).toContain('Candidate answer: 我会说明 REQUIRED 和 REQUIRES_NEW 的区别。');
  });
});
