import 'reflect-metadata';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { UnauthorizedException } from '@nestjs/common';

import { appConfig } from '../../config';
import { AuthService } from './auth.service';

test('AuthService.login returns a deterministic demo token for valid credentials', () => {
  const service = new AuthService();

  const result = service.login(appConfig.demoUsername, appConfig.demoPassword);

  assert.deepEqual(result, {
    username: appConfig.demoUsername,
    token: createHash('sha256').update(`${appConfig.demoUsername}:${appConfig.demoPassword}:demo-token`).digest('hex'),
  });
});

test('AuthService.login rejects invalid credentials', () => {
  const service = new AuthService();

  assert.throws(() => service.login('wrong-user', 'wrong-password'), UnauthorizedException);
});