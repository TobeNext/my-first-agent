import { PinoLogger } from '@mastra/loggers';

export const mastraLogger = new PinoLogger({
  name: 'Mastra',
  level: 'info',
});