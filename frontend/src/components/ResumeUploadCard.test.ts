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
});