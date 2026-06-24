import { describe, expect, it } from 'vitest';

import { parseHttpErrorPayload } from './http-error';

describe('parseHttpErrorPayload', () => {
  it('returns the fallback and details when the payload message is an array', async () => {
    const response = new Response(JSON.stringify({ message: ['问题 1', '问题 2'] }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    await expect(
      parseHttpErrorPayload(response, {
        arrayMessageFallback: '请根据以下问题修正请求。',
      }),
    ).resolves.toEqual({
      message: '请根据以下问题修正请求。',
      details: ['问题 1', '问题 2'],
    });
  });

  it('returns the message when the payload contains a single error string', async () => {
    const response = new Response(JSON.stringify({ message: '权限不足。' }), {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    await expect(parseHttpErrorPayload(response)).resolves.toEqual({
      message: '权限不足。',
    });
  });

  it('falls back to the first array item when no explicit array fallback is provided', async () => {
    const response = new Response(JSON.stringify({ message: ['第一条错误', '第二条错误'] }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    await expect(parseHttpErrorPayload(response)).resolves.toEqual({
      message: '第一条错误',
      details: ['第一条错误', '第二条错误'],
    });
  });

  it('falls back to the status message for an empty message array without explicit fallback', async () => {
    const response = new Response(JSON.stringify({ message: [] }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    await expect(parseHttpErrorPayload(response)).resolves.toEqual({
      message: 'Request failed with status 400.',
      details: [],
    });
  });

  it('falls back to the status message when the JSON payload does not include a message', async () => {
    const response = new Response(JSON.stringify({}), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    await expect(parseHttpErrorPayload(response)).resolves.toEqual({
      message: 'Request failed with status 401.',
    });
  });

  it('falls back to the raw text only when requested', async () => {
    const response = new Response('upstream exploded', {
      status: 502,
    });

    await expect(
      parseHttpErrorPayload(response, {
        includeRawTextFallback: true,
      }),
    ).resolves.toEqual({
      message: 'upstream exploded',
    });
  });

  it('falls back to the status message when the payload is not parseable', async () => {
    const response = new Response('not-json', {
      status: 500,
    });

    await expect(parseHttpErrorPayload(response)).resolves.toEqual({
      message: 'Request failed with status 500.',
    });
  });

  it('falls back to the status message for an empty raw text payload', async () => {
    const response = new Response('', {
      status: 502,
    });

    await expect(
      parseHttpErrorPayload(response, {
        includeRawTextFallback: true,
      }),
    ).resolves.toEqual({
      message: 'Request failed with status 502.',
    });
  });

  it('falls back to the status message when the body cannot be read', async () => {
    const response = {
      status: 503,
      text: async () => {
        throw new Error('body locked');
      },
    } as unknown as Response;

    await expect(parseHttpErrorPayload(response)).resolves.toEqual({
      message: 'Request failed with status 503.',
    });
  });
});
