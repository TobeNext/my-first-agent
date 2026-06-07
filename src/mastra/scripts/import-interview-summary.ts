import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import { chunkAndEmbed } from '../lib/rag-pipeline';
import { buildSkillAreaAudit, cleanInterviewQuestionMetadata } from '../lib/interview-question-metadata';
import { EMBEDDING_DIMENSION, INTERVIEW_INDEX_NAME, vectorStore } from '../lib/vector-store';

const DEFAULT_FILE_PATH = 'C:/Users/Blaine.Yu/Documents/Notes/Summary/Learning/AI Agent面试问题整理-回答要点版.md';
const DEFAULT_ROLE = 'AI Agent Engineer';

const importedQuestionSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  questionType: z.enum(['behavioral', 'technical', 'system-design', 'culture-fit', 'case-study']),
  company: z.string().default('general'),
  role: z.string().default(DEFAULT_ROLE),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  tags: z.array(z.string()).default([]),
  source: z.string().default('ai-agent-summary'),
  mainCategory: z.string().min(1),
  subCategory: z.string().min(1),
});

type ImportedQuestion = z.infer<typeof importedQuestionSchema>;

function normalizeQuestion(rawHeading: string): string {
  return rawHeading
    .replace(/^\d+[.)、：:\s]*/, '')
    .replace(/\[补\]\s*$/u, '')
    .trim();
}

function normalizeAnswer(rawAnswer: string): string {
  return rawAnswer
    .replace(/^回答要点[:：]\s*/u, '')
    .trim();
}

function inferQuestionType(input: { mainCategory: string; subCategory: string; question: string }): ImportedQuestion['questionType'] {
  const text = `${input.mainCategory} ${input.subCategory} ${input.question}`;
  if (/架构|设计|模块|分层|状态机|Workflow|工作流|Multi-Agent|多Agent|平台|演进|路由|fallback|停止条件|成本优化/iu.test(text)) {
    return 'system-design';
  }

  if (/沟通|协作|团队|冲突|管理|文化|反馈/iu.test(text)) {
    return 'culture-fit';
  }

  if (/案例|case/iu.test(text)) {
    return 'case-study';
  }

  return 'technical';
}

function inferDifficulty(input: { subCategory: string; question: string; answer: string }): ImportedQuestion['difficulty'] {
  const text = `${input.subCategory} ${input.question}`;
  if (/设计|演进|优化|停止条件|阈值|拆分|状态机|补偿|fallback|Multi-Agent|多Agent|上下文工程/iu.test(text)) {
    return 'hard';
  }

  if (input.answer.length < 180 && /什么是|区别|影响|流程|参数/iu.test(text)) {
    return 'easy';
  }

  return 'medium';
}

function buildTags(input: { mainCategory: string; subCategory: string; question: string }): string[] {
  const tags = new Set<string>([input.mainCategory, input.subCategory]);
  const keywordMap: Array<[RegExp, string]> = [
    [/Agent|智能体/iu, 'agent'],
    [/Workflow|工作流/iu, 'workflow'],
    [/Multi-Agent|多Agent|多智能体/iu, 'multi-agent'],
    [/RAG|检索|向量|知识库/iu, 'rag'],
    [/Memory|记忆|上下文/iu, 'memory'],
    [/Function Call|工具调用|Tool Use|MCP/iu, 'tool-calling'],
    [/CoT|ReAct|Few-shot|Planning/iu, 'reasoning'],
    [/成本|路由|fallback|缓存|SLA/iu, 'model-routing'],
    [/TypeScript|C#|Java/iu, 'engineering'],
  ];

  for (const [pattern, tag] of keywordMap) {
    if (pattern.test(`${input.question} ${input.subCategory}`)) {
      tags.add(tag);
    }
  }

  return [...tags];
}

function parseQuestionsFromMarkdown(content: string): ImportedQuestion[] {
  const questions: ImportedQuestion[] = [];
  const lines = content.split(/\r?\n/u);

  let currentMainCategory = '';
  let currentSubCategory = '';
  let currentQuestionHeading = '';
  let currentAnswerLines: string[] = [];

  const flushQuestion = (): void => {
    if (!currentQuestionHeading) {
      return;
    }

    const question = normalizeQuestion(currentQuestionHeading);
    const answer = normalizeAnswer(currentAnswerLines.join('\n').trim());

    if (!question || !/[？?]/u.test(question) || !answer) {
      currentQuestionHeading = '';
      currentAnswerLines = [];
      return;
    }

    const payload = importedQuestionSchema.parse({
      question,
      answer,
      questionType: inferQuestionType({
        mainCategory: currentMainCategory,
        subCategory: currentSubCategory,
        question,
      }),
      difficulty: inferDifficulty({
        subCategory: currentSubCategory,
        question,
        answer,
      }),
      tags: buildTags({
        mainCategory: currentMainCategory,
        subCategory: currentSubCategory,
        question,
      }),
      mainCategory: currentMainCategory,
      subCategory: currentSubCategory,
    });

    questions.push(payload);
    currentQuestionHeading = '';
    currentAnswerLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith('#### ')) {
      flushQuestion();
      currentQuestionHeading = line.replace(/^####\s+/u, '');
      continue;
    }

    if (line.startsWith('### ')) {
      flushQuestion();
      currentSubCategory = line.replace(/^###\s+/u, '').trim();
      continue;
    }

    if (line.startsWith('## ')) {
      flushQuestion();
      currentMainCategory = line.replace(/^##\s+/u, '').trim();
      currentSubCategory = '';
      continue;
    }

    if (currentQuestionHeading) {
      currentAnswerLines.push(line);
    }
  }

  flushQuestion();
  return questions;
}

async function recreateIndex(): Promise<void> {
  const existingIndexes = await vectorStore.listIndexes();
  if (existingIndexes.includes(INTERVIEW_INDEX_NAME)) {
    await vectorStore.deleteIndex({ indexName: INTERVIEW_INDEX_NAME });
  }

  await vectorStore.createIndex({
    indexName: INTERVIEW_INDEX_NAME,
    dimension: EMBEDDING_DIMENSION,
  });
}

async function importQuestions(questions: readonly ImportedQuestion[], sourceFile: string): Promise<number> {
  let totalChunks = 0;
  const importedMetadata: ReturnType<typeof cleanInterviewQuestionMetadata>[] = [];

  for (const question of questions) {
    const content = `# ${question.question}\n\n## 回答要点\n${question.answer}`;
    const { chunks, embeddings } = await chunkAndEmbed({
      content,
      format: 'markdown',
      metadata: {
        question: question.question,
        answer: question.answer,
        questionType: question.questionType,
        company: question.company,
        role: question.role,
        difficulty: question.difficulty,
        source: question.source,
        tags: question.tags,
        mainCategory: question.mainCategory,
        subCategory: question.subCategory,
        sourceFile,
      },
      chunkSize: 2000,
      chunkOverlap: 120,
    });

    if (chunks.length === 0) {
      continue;
    }

    await vectorStore.upsert({
      indexName: INTERVIEW_INDEX_NAME,
      vectors: embeddings,
      metadata: chunks.map((chunk) => {
        const cleaned = cleanInterviewQuestionMetadata(chunk.metadata);
        importedMetadata.push(cleaned);
        return cleaned;
      }),
    });

    totalChunks += chunks.length;
    console.log(`  ✓ ${question.question} -> ${chunks.length} chunk(s)`);
  }

  console.log('  Skill area audit:');
  for (const [skill, count] of Object.entries(buildSkillAreaAudit(importedMetadata))) {
    console.log(`    ${skill}: ${count}`);
  }

  return totalChunks;
}

async function main(): Promise<void> {
  const filePath = process.argv[2] || DEFAULT_FILE_PATH;
  const absolutePath = resolve(filePath);
  const raw = readFileSync(absolutePath, 'utf-8');

  console.log('═══════════════════════════════════════════');
  console.log('  Interview Summary -> Vector DB Import');
  console.log('═══════════════════════════════════════════');
  console.log(`  Source: ${absolutePath}`);

  const questions = parseQuestionsFromMarkdown(raw);
  if (questions.length === 0) {
    throw new Error('No valid interview questions were parsed from the markdown file.');
  }

  console.log(`  Parsed questions: ${questions.length}`);
  console.log('  Recreating vector index...');
  await recreateIndex();

  const chunkCount = await importQuestions(questions, absolutePath);
  console.log(`\nDone! Imported ${questions.length} questions as ${chunkCount} vector chunks.`);
}

main().catch((error) => {
  console.error('Import failed:', error);
  process.exit(1);
});
