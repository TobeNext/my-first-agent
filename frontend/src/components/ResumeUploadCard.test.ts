import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';

import { useResumeUploadStore } from '@/stores/upload';

import ResumeUploadCard from './ResumeUploadCard.vue';

describe('ResumeUploadCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('renders each BFF validation detail on its own line', () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const store = useResumeUploadStore();
    store.localResult = {
      success: true,
      fileName: 'resume.md',
      fileSize: 512,
      message: '文件格式与大小校验通过。',
      source: 'frontend',
    };
    store.bffResult = {
      success: false,
      fileName: 'resume.md',
      fileSize: 512,
      message: 'BFF 校验失败，请根据以下问题修改简历。',
      details: ['缺少章节：### 专业技能。', '第 5 行（项目经历）："- " 后必须填写具体内容。'],
      source: 'bff',
    };

    const wrapper = mount(ResumeUploadCard, {
      global: {
        plugins: [pinia],
      },
    });

    const detailLines = wrapper
      .findAll('.upload-card__result p:not(.upload-card__result-title):not(.upload-card__result-meta)')
      .map((node) => node.text());

    expect(detailLines).toEqual([
      '前端校验：文件格式与大小校验通过。',
      'BFF 校验：缺少章节：### 专业技能。',
      'BFF 校验：第 5 行（项目经历）："- " 后必须填写具体内容。',
    ]);
  });

  it('renders the optional job description guidance', () => {
    const wrapper = mount(ResumeUploadCard, {
      global: {
        plugins: [createPinia()],
      },
    });

    expect(wrapper.text()).toContain('职位 JD 文件');
    expect(wrapper.text()).toContain('不上传时默认为空，并继续沿用现有简历 RAG 方式');
  });

  it('shows a disabled CTA before the resume is ready', () => {
    const wrapper = mount(ResumeUploadCard, {
      global: {
        plugins: [createPinia()],
      },
    });

    const primaryButton = wrapper.find('.upload-card__button--primary');

    expect(wrapper.text()).toContain('上传完成后可继续进入面试配置');
    expect(wrapper.text()).toContain('请先上传并校验简历。职位 JD 为选填项，未上传不会阻止进入下一步。');
    expect(primaryButton.text()).toBe('请先完成简历校验');
    expect(primaryButton.attributes('disabled')).toBeDefined();
  });

  it('shows a ready CTA and emits continue when the upload is ready', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);

    const store = useResumeUploadStore();
    store.bffResult = {
      success: true,
      fileName: 'resume.md',
      fileSize: 512,
      message: '文件已通过 BFF 校验。',
      professionalSkillGroupCount: 2,
      source: 'bff',
    };
    store.interviewResume = {
      fileName: 'resume.md',
      markdown: '### 专业技能\n- TypeScript',
      professionalSkillGroupCount: 2,
      jobDescriptionFileName: 'job-description.md',
      jobDescriptionMarkdown: '### 岗位职责\n- 负责 AI 面试系统',
    };

    const wrapper = mount(ResumeUploadCard, {
      global: {
        plugins: [pinia],
      },
    });

    const primaryButton = wrapper.find('.upload-card__button--primary');

    expect(wrapper.text()).toContain('已可进入面试配置');
    expect(wrapper.text()).toContain('简历与职位 JD 已就绪。你现在可以继续进入面试配置。');
    expect(wrapper.text()).toContain('简历：resume.md');
    expect(wrapper.text()).toContain('职位 JD：job-description.md');
    expect(primaryButton.attributes('disabled')).toBeUndefined();

    await primaryButton.trigger('click');

    expect(wrapper.emitted('continue')).toEqual([[]]);
  });
});