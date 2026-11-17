import { z } from 'zod';
import { Store, id, now } from './db.js';
import { Imports } from './imports.js';
import { requireThat } from './errors.js';

export class CSVUploads {
  constructor(
    private readonly store: Store,
    private readonly imports: Imports,
  ) {}
  async begin(raw: unknown, actor: string) {
    const body = z
      .object({
        kind: z.enum(['catalog', 'sales']),
        filename: z
          .string()
          .max(200)
          .regex(/\.csv$/i),
        chunks: z.number().int().min(1).max(100),
      })
      .parse(raw);
    return this.store.tx(async () => {
      await this.store.run('DELETE FROM csv_uploads WHERE expires_at<?', now());
      const count = Number(
        (await this.store.get('SELECT COUNT(*) total FROM csv_uploads WHERE user_id=?', actor))!
          .total,
      );
      requireThat(
        count < 3,
        'Finish or wait for previous uploads to expire before starting another.',
        409,
      );
      const uploadId = id();
      await this.store.run(
        'INSERT INTO csv_uploads VALUES (?,?,?,?,?,?)',
        uploadId,
        actor,
        body.kind,
        body.filename,
        body.chunks,
        new Date(Date.now() + 30 * 60000).toISOString(),
      );
      return { id: uploadId };
    });
  }
  private async owned(uploadId: string, actor: string) {
    const row = await this.store.get(
      'SELECT * FROM csv_uploads WHERE id=? AND user_id=? AND expires_at>?',
      uploadId,
      actor,
      now(),
    );
    requireThat(row, 'Upload is missing or expired. Select the CSV and try again.', 404);
    return row;
  }
  async chunk(uploadId: string, index: number, raw: unknown, actor: string) {
    const body = z.object({ content: z.string().max(800000) }).parse(raw);
    requireThat(Buffer.byteLength(body.content) <= 1024 * 1024, 'Upload chunk exceeds 1 MiB', 413);
    return this.store.tx(async () => {
      const row = await this.owned(uploadId, actor);
      requireThat(
        Number.isInteger(index) && index >= 0 && index < row.chunk_count,
        'Invalid upload chunk',
      );
      const prior = await this.store.get(
        'SELECT content FROM csv_upload_chunks WHERE upload_id=? AND chunk_number=?',
        uploadId,
        index,
      );
      if (prior) {
        requireThat(
          prior.content === body.content,
          'A retry changed an uploaded chunk. Start a new upload.',
          409,
        );
        return { ok: true };
      }
      const totals = await this.store.get(
        'SELECT COALESCE(SUM(' +
          (this.store.dialect === 'postgres'
            ? 'OCTET_LENGTH(content)'
            : 'LENGTH(CAST(content AS BLOB))') +
          '),0) total FROM csv_upload_chunks WHERE upload_id=?',
        uploadId,
      );
      requireThat(
        Number(totals!.total) + Buffer.byteLength(body.content) <= 20 * 1024 * 1024,
        'CSV exceeds 20 MiB limit',
        413,
      );
      await this.store.run(
        'INSERT INTO csv_upload_chunks VALUES (?,?,?)',
        uploadId,
        index,
        body.content,
      );
      return { ok: true };
    });
  }
  async preview(uploadId: string, actor: string) {
    const row = await this.owned(uploadId, actor);
    const chunks = await this.store.all(
      'SELECT chunk_number,content FROM csv_upload_chunks WHERE upload_id=? ORDER BY chunk_number',
      uploadId,
    );
    requireThat(
      chunks.length === row.chunk_count &&
        chunks.every((chunk, index) => chunk.chunk_number === index),
      'The upload is incomplete. Select the CSV and try again.',
      409,
    );
    try {
      return await this.imports.upload(
        row.kind,
        row.filename,
        chunks.map((chunk) => chunk.content).join(''),
        actor,
      );
    } finally {
      await this.store.run('DELETE FROM csv_uploads WHERE id=? AND user_id=?', uploadId, actor);
    }
  }
}
