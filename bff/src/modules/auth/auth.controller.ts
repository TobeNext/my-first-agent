import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';

import { AuthService } from './auth.service';

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required.'),
  password: z.string().min(1, 'Password is required.'),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() body: unknown): { readonly token: string; readonly username: string } {
    const parsed = loginSchema.parse(body);
    return this.authService.login(parsed.username, parsed.password);
  }
}