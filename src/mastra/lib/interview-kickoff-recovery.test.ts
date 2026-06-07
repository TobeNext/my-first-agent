import { describe, expect, it } from 'vitest';

import { buildInterviewStartRequest } from '../../../bff/src/modules/agent/interview-start-contract';

import {
  detectKickoffPayloadFormat,
  extractJobDescriptionMarkdownFromKickoffMessage,
  extractMarkdownSection,
  extractParsedResumeFromKickoffMessage,
  extractResumeMarkdownFromKickoffMessage,
  extractResumeSectionsFromKickoffMessage,
  extractStructuredInterviewStartRequest,
  recoverMissingInterviewSession,
} from './interview-kickoff-recovery';

describe('interview-kickoff-recovery', () => {
  it('detects structured, legacy, and freeform kickoff payloads', () => {
    const structured = JSON.stringify(
      buildInterviewStartRequest({
        threadId: 'thread-1',
        resumeMarkdown: '### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF',
        jobDescriptionMarkdown: '### 岗位职责\n- 负责 AI 面试系统',
        settings: {
          reviewIncorrectOrMissingPoints: true,
          skipProfessionalSkillsRound: false,
          skipProjectExperienceRound: false,
          enableFlowTestMode: false,
          professionalQuestionMode: 'per-skill-default',
          professionalQuestionCount: 1,
          projectQuestionCount: 1,
        },
      }),
    );

    expect(detectKickoffPayloadFormat(structured)).toBe('structured-start-v1');
    expect(
      detectKickoffPayloadFormat(['Selected interview direction: AI Agent Engineer', 'Resume Markdown:', '### 专业技能'].join('\n')),
    ).toBe('legacy-kickoff');
    expect(detectKickoffPayloadFormat('直接开始一次面试。')).toBe('freeform');
  });

  it('extracts structured and legacy kickoff markdown payloads', () => {
    const structuredRequest = buildInterviewStartRequest({
      threadId: 'thread-2',
      resumeMarkdown: '### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF',
      jobDescriptionMarkdown: '### 岗位职责\n- 负责 AI 面试系统',
      settings: {
        reviewIncorrectOrMissingPoints: true,
        skipProfessionalSkillsRound: false,
        skipProjectExperienceRound: false,
        enableFlowTestMode: false,
        professionalQuestionMode: 'per-skill-default',
        professionalQuestionCount: 1,
        projectQuestionCount: 1,
      },
      resumeSections: {
        professionalSkills: '- TypeScript',
        projectExperience: '- 搭建 BFF',
      },
    });
    const structured = JSON.stringify(structuredRequest);
    const legacy = [
      'Resume Markdown:',
      '### 专业技能',
      '- TypeScript',
      '',
      '### 项目经历',
      '- 搭建 BFF',
      '',
      'Job Description Markdown:',
      '### 岗位职责',
      '- 负责 AI 面试系统',
    ].join('\n');

    expect(extractStructuredInterviewStartRequest(structured)).toEqual(structuredRequest);
    expect(extractResumeMarkdownFromKickoffMessage(structured)).toBe(structuredRequest.resumeMarkdown);
    expect(extractJobDescriptionMarkdownFromKickoffMessage(structured)).toBe(structuredRequest.jobDescriptionMarkdown);
    expect(extractResumeMarkdownFromKickoffMessage(legacy)).toBe('### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF');
    expect(extractJobDescriptionMarkdownFromKickoffMessage(legacy)).toBe('### 岗位职责\n- 负责 AI 面试系统');
    expect(extractJobDescriptionMarkdownFromKickoffMessage('Resume Markdown:\n### 专业技能')).toBe('');
  });

  it('extracts markdown sections and prefers structured resume sections when provided', () => {
    const structured = JSON.stringify(
      buildInterviewStartRequest({
        threadId: 'thread-3',
        resumeMarkdown: '### 专业技能\n- TypeScript\n\n### 项目经历\n- 搭建 BFF',
        settings: {
          reviewIncorrectOrMissingPoints: true,
          skipProfessionalSkillsRound: false,
          skipProjectExperienceRound: false,
          enableFlowTestMode: false,
          professionalQuestionMode: 'per-skill-default',
          professionalQuestionCount: 1,
          projectQuestionCount: 1,
        },
        resumeSections: {
          professionalSkills: '- Structured TypeScript',
          projectExperience: '- Structured Project',
        },
      }),
    );

    expect(
      extractMarkdownSection(['### 专业技能', '- TypeScript', '', '### 项目经历', '- 搭建 BFF'].join('\n'), '专业技能'),
    ).toBe('- TypeScript');
    expect(extractMarkdownSection('### 专业技能\n- TypeScript', '项目经历')).toBe('');
    expect(extractMarkdownSection('### 专业技能\n- TypeScript', '其他信息')).toBe('');
    expect(extractResumeSectionsFromKickoffMessage(structured)).toEqual({
      professionalSkills: '- Structured TypeScript',
      projectExperience: '- Structured Project',
    });
  });

  it('extracts the canonical parsed resume result from structured and legacy kickoff payloads', () => {
    const structured = JSON.stringify(
      buildInterviewStartRequest({
        threadId: 'thread-structured',
        resumeMarkdown: '### 专业技能\n- Legacy TypeScript\n\n### 项目经历\n- Legacy Project',
        settings: {
          reviewIncorrectOrMissingPoints: true,
          skipProfessionalSkillsRound: false,
          skipProjectExperienceRound: false,
          enableFlowTestMode: false,
          professionalQuestionMode: 'per-skill-default',
          professionalQuestionCount: 1,
          projectQuestionCount: 1,
        },
        resumeSections: {
          professionalSkills: '- Structured TypeScript\n- Mastra',
          projectExperience: '- Structured Project',
        },
      }),
    );
    const legacy = [
      'Resume Markdown:',
      '### 专业技能',
      '- TypeScript',
      '- RAG',
      '',
      '### 项目经历',
      '- 搭建 BFF',
    ].join('\n');
    const structuredWithoutSections = JSON.stringify(
      buildInterviewStartRequest({
        threadId: 'thread-structured-no-sections',
        resumeMarkdown: '## Skills:\n1. Parsed From Markdown\n\nProject Experience:\nParsed Project',
        settings: {
          reviewIncorrectOrMissingPoints: true,
          skipProfessionalSkillsRound: false,
          skipProjectExperienceRound: false,
          enableFlowTestMode: false,
          professionalQuestionMode: 'per-skill-default',
          professionalQuestionCount: 1,
          projectQuestionCount: 1,
        },
      }),
    );

    expect(extractParsedResumeFromKickoffMessage(structured)).toEqual({
      professionalSkillsSection: '- Structured TypeScript\n- Mastra',
      projectExperienceSection: '- Structured Project',
      normalizedSkills: ['Structured TypeScript', 'Mastra'],
      normalizedProjectTopics: ['Structured Project'],
      warnings: [],
      validationErrors: [],
    });
    expect(extractParsedResumeFromKickoffMessage(legacy)).toEqual({
      professionalSkillsSection: '- TypeScript\n- RAG',
      projectExperienceSection: '- 搭建 BFF',
      normalizedSkills: ['TypeScript', 'RAG'],
      normalizedProjectTopics: ['搭建 BFF'],
      warnings: [],
      validationErrors: [],
    });
    expect(extractParsedResumeFromKickoffMessage(structuredWithoutSections)).toEqual({
      professionalSkillsSection: '1. Parsed From Markdown',
      projectExperienceSection: 'Parsed Project',
      normalizedSkills: ['Parsed From Markdown'],
      normalizedProjectTopics: ['Parsed Project'],
      warnings: [
        '第 1 行：已将标题“## Skills:”兼容识别为“### 专业技能”。',
        '第 4 行：已将标题“Project Experience:”兼容识别为“### 项目经历”。',
        '第 4 行（项目经历）：未使用标准列表标记，已按逐行条目兼容解析。',
      ],
      validationErrors: [],
    });
  });

  it('recovers a generic kickoff into an initialized interview session', () => {
    const state = recoverMissingInterviewSession({
      threadId: 'thread-4',
      rawKickoffMessage: [
        'Selected interview direction: AI Agent Engineer',
        'Direction source: preset',
        'Resume Markdown:',
        '### 专业技能',
        '- TypeScript',
        '- RAG',
        '',
        '### 项目经历',
        '- 搭建 BFF',
      ].join('\n'),
    });

    expect(state.phase).toBe('professional-skills-round');
    expect(state.resumeContext.professionalSkills).toContain('TypeScript');
    expect(state.resumeContext.projectExperience).toContain('搭建 BFF');
    expect(state.resumeContext.jobDescription).toBe('');
  });

  it('prefers explicit section overrides when recovering the interview session', () => {
    const state = recoverMissingInterviewSession({
      threadId: 'thread-5',
      rawKickoffMessage: '直接开始一次面试。',
      professionalSkills: '- Override Skill',
      projectExperience: '- Override Project',
      jobDescription: '### 岗位职责\n- Override JD',
    });

    expect(state.resumeContext.professionalSkills).toBe('- Override Skill');
    expect(state.resumeContext.projectExperience).toBe('- Override Project');
    expect(state.resumeContext.jobDescription).toBe('### 岗位职责\n- Override JD');
  });

  it('supports partial overrides and explicit normalized arrays during recovery', () => {
    const state = recoverMissingInterviewSession({
      threadId: 'thread-6',
      rawKickoffMessage: [
        'Selected interview direction: AI Agent Engineer',
        'Direction source: preset',
        'Resume Markdown:',
        '### 专业技能',
        '- TypeScript',
        '- RAG',
        '',
        '### 项目经历',
        '- 搭建 BFF',
      ].join('\n'),
      professionalSkills: '- Override Skill',
      normalizedProfessionalSkills: ['Override Skill'],
      normalizedProjectTopics: ['Recovered Project Topic'],
    });

    expect(state.resumeContext.professionalSkills).toBe('- Override Skill');
    expect(state.resumeContext.projectExperience).toBe('- 搭建 BFF');
    expect(state.rounds[0]?.nodes[0]?.topic).toBe('Override Skill');
    expect(state.rounds[1]?.nodes[0]?.topic).toBe('Recovered Project Topic');
  });
});