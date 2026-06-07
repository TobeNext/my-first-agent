import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import {
  chatRequestSchema,
  feedbackRequestSchema,
  parseRequestBody,
} from './agent.schemas';

function getBadRequestMessage(callback: () => unknown): string {
  try {
    callback();
    assert.fail('Expected parseRequestBody() to throw BadRequestException.');
  } catch (error) {
    assert.ok(error instanceof BadRequestException);
    const response = error.getResponse() as { readonly message?: string };
    const message = response.message;
    if (typeof message !== 'string') {
      assert.fail('Expected BadRequestException to expose a string message.');
    }

    return message;
  }
}

test('parseRequestBody parses a continue-interview payload and defaults startInterview to false', () => {
  const result = parseRequestBody(chatRequestSchema, {
    threadId: 'thread-1',
    message: '继续面试。',
  });

  assert.deepEqual(result, {
    threadId: 'thread-1',
    message: '继续面试。',
    startInterview: false,
  });
});

test('parseRequestBody parses feedback payloads and trims the optional comment', () => {
  const result = parseRequestBody(feedbackRequestSchema, {
    threadId: 'thread-1',
    overallExperienceScore: 5,
    questionFitScore: 4,
    difficultyScore: 4,
    comment: '  很贴近真实岗位。  ',
  });

  assert.deepEqual(result, {
    threadId: 'thread-1',
    overallExperienceScore: 5,
    questionFitScore: 4,
    difficultyScore: 4,
    comment: '很贴近真实岗位。',
  });
});

test('parseRequestBody fills the default empty feedback comment when omitted', () => {
  const result = parseRequestBody(feedbackRequestSchema, {
    threadId: 'thread-1',
    overallExperienceScore: 5,
    questionFitScore: 4,
    difficultyScore: 4,
  });

  assert.deepEqual(result, {
    threadId: 'thread-1',
    overallExperienceScore: 5,
    questionFitScore: 4,
    difficultyScore: 4,
    comment: '',
  });
});

test('parseRequestBody rejects invalid request bodies with the first schema message', () => {
  const message = getBadRequestMessage(() =>
    parseRequestBody(chatRequestSchema, {
      threadId: '',
      message: '   ',
    }),
  );

  assert.equal(message, 'Thread ID is required.');
});