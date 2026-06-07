import { describe, expect, it } from 'vitest';

import { buildRerankedEntries, extractJdSkillArea } from '../tools/interview-question-tool';

describe('interview question skillArea rerank', () => {
  it('extracts JD skillArea from mixed JD text', () => {
    expect(extractJdSkillArea('岗位要求：Java、Spring Boot、微服务、Milvus 向量数据库')).toEqual(
      expect.arrayContaining(['java', 'spring', 'microservices', 'milvus']),
    );
  });

  it('scores rerank matches from candidate skillArea instead of answer or legacy fields', () => {
    const entries = buildRerankedEntries('JD: Spring Boot 微服务经验', [
      {
        id: 'legacy-text-match',
        score: 0.9,
        metadata: {
          question: 'TypeScript 工具调用怎么设计？',
          answer: '这个答案故意提到 Spring Boot 和微服务，但不应该参与 rerank。',
          mainCategory: 'Spring',
          subCategory: '微服务',
          tags: ['Spring Boot'],
          skillArea: ['typescript', 'tool-calling'],
        },
      },
      {
        id: 'skill-area-match',
        score: 0.9,
        metadata: {
          question: 'Spring 微服务网关如何设计？',
          answer: '候选技能字段命中。',
          skillArea: ['spring', 'microservices'],
        },
      },
    ]);

    expect(entries[0]?.result.id).toBe('skill-area-match');
    expect(entries[0]?.matchedSkillArea).toEqual(['spring', 'microservices']);
    expect(entries[1]?.bm25Score).toBe(0);
  });
});
