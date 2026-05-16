import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { appConfig } from '../../config';

@Injectable()
export class AuthService {
  login(username: string, password: string): { readonly token: string; readonly username: string } {
    if (username !== appConfig.demoUsername || password !== appConfig.demoPassword) {
      throw new UnauthorizedException('Invalid username or password.');
    }

    const token = createHash('sha256')
      .update(`${username}:${password}:demo-token`)
      .digest('hex');

    return {
      token,
      username,
    };
  }
}