import type { SharedMemoryConfig } from '@mastra/core/memory';
import { Memory } from '@mastra/memory';

/**
 * @mastra/memory 1.6.x does not forward options.readOnly into threadConfig during construction.
 * This subclass reapplies the merged thread config so schema-based working memory can stay read-only
 * for the model while custom tools continue to update it programmatically.
 */
export class ReadOnlyThreadMemory extends Memory {
  constructor(config: SharedMemoryConfig = {}) {
    super(config);

    this.threadConfig = this.getMergedThreadConfig({
      readOnly: config.options?.readOnly ?? true,
      lastMessages: config.options?.lastMessages,
      semanticRecall: config.options?.semanticRecall,
      generateTitle: config.options?.generateTitle,
      workingMemory: config.options?.workingMemory,
      observationalMemory: config.options?.observationalMemory,
    });
  }
}