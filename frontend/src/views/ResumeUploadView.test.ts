import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

import ResumeUploadView from './ResumeUploadView.vue';

describe('ResumeUploadView', () => {
  beforeEach(() => {
    pushMock.mockReset();
    pushMock.mockResolvedValue(undefined);
  });

  it('navigates to the agent chat view when the upload card emits continue', async () => {
    const wrapper = mount(ResumeUploadView, {
      global: {
        stubs: {
          ResumeUploadCard: {
            template: '<button data-test="continue" @click="$emit(\'continue\')">Continue</button>',
          },
        },
      },
    });

    await wrapper.get('[data-test="continue"]').trigger('click');

    expect(pushMock).toHaveBeenCalledWith({ name: 'agent-chat' });
  });
});