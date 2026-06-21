import './telemetry';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { appConfig } from './config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    credentials: false,
  });
  app.setGlobalPrefix('api');

  await app.listen(appConfig.port);
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to start BFF:', error);
  process.exit(1);
});
