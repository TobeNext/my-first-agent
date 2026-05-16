import { MDocument } from '@mastra/rag';
import { embedMany } from 'ai';
import { fastembed } from '@mastra/fastembed';

interface ChunkWithMetadata {
  text: string;
  metadata: Record<string, unknown>;
}

interface EmbeddingResult {
  chunks: ChunkWithMetadata[];
  embeddings: number[][];
}

/**
 * Split text content into chunks and generate vector embeddings using local fastembed.
 *
 * @param options.content - Raw text content to process
 * @param options.format - Content format for proper parsing
 * @param options.metadata - Metadata to attach to every chunk
 * @param options.chunkSize - Max characters per chunk (default: 512)
 * @param options.chunkOverlap - Overlap characters between chunks (default: 50)
 * @returns Chunks with metadata and their corresponding embedding vectors
 */
export async function chunkAndEmbed(options: {
  content: string;
  format: 'text' | 'markdown' | 'html';
  metadata: Record<string, unknown>;
  chunkSize?: number;
  chunkOverlap?: number;
}): Promise<EmbeddingResult> {
  const { content, format, metadata, chunkSize = 512, chunkOverlap = 50 } = options;

  // 1. Create MDocument based on format
  const doc = format === 'markdown'
    ? MDocument.fromMarkdown(content)
    : format === 'html'
      ? MDocument.fromHTML(content)
      : MDocument.fromText(content);

  // 2. Chunk with recursive strategy
  const rawChunks = await doc.chunk({
    strategy: 'recursive',
    maxSize: chunkSize,
    overlap: chunkOverlap,
  });

  // 3. Attach metadata to each chunk
  const chunks: ChunkWithMetadata[] = rawChunks.map((chunk) => ({
    text: chunk.text,
    metadata: { ...metadata, text: chunk.text },
  }));

  if (chunks.length === 0) {
    return { chunks: [], embeddings: [] };
  }

  // 4. Generate embeddings with local fastembed
  const { embeddings } = await embedMany({
    model: fastembed,
    values: chunks.map((c) => c.text),
  });

  return { chunks, embeddings };
}
