import { describe, expect, it } from 'vitest';

import {
  buildSkillAreaAudit,
  cleanInterviewQuestionMetadata,
  normalizeSkillAreaFromText,
} from './interview-question-metadata';

describe('interview question metadata contract', () => {
  it('removes legacy fields, promotes scalars, and backfills skillArea', () => {
    const metadata = cleanInterviewQuestionMetadata({
      question: 'Spring Cloud 微服务如何做链路追踪？',
      answer: '需要覆盖 trace、日志、网关和服务治理。',
      text: 'Spring Cloud observability',
      role: 'Backend Engineer',
      difficulty: 'hard',
      company: 'general',
      mainCategory: '后端',
      subCategory: '微服务',
      tags: ['Spring', 'trace'],
      source: 'fixture',
    });

    expect(metadata).toMatchObject({
      question: 'Spring Cloud 微服务如何做链路追踪？',
      answer: '需要覆盖 trace、日志、网关和服务治理。',
      role: 'Backend Engineer',
      difficulty: 'hard',
      source: 'fixture',
    });
    expect(metadata.skillArea).toEqual(expect.arrayContaining(['spring', 'microservices', 'observability']));
    expect(metadata).not.toHaveProperty('company');
    expect(metadata).not.toHaveProperty('mainCategory');
    expect(metadata).not.toHaveProperty('subCategory');
    expect(metadata).not.toHaveProperty('tags');
  });

  it('normalizes mixed Chinese and English skill signals and audits coverage', () => {
    const skillArea = normalizeSkillAreaFromText('JD: Java, Spring Boot, RAG 检索, Milvus 向量数据库');

    expect(skillArea).toEqual(expect.arrayContaining(['java', 'spring', 'rag', 'milvus']));
    expect(buildSkillAreaAudit([{ skillArea }, { skillArea: ['spring'] }])).toMatchObject({
      java: 1,
      spring: 2,
      rag: 1,
      milvus: 1,
    });
  });
});
