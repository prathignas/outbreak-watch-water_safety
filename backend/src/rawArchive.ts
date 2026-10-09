/*
 * Where raw copies go (P2's RawArchive): the Open-Meteo answer, each feed batch and each
 * webhook batch, filed by India day under raw/<source>/<YYYY-MM-DD>/.
 * - RAW_BUCKET set (AWS): S3. Each Lambda may only write its own prefix (infra).
 * - RAW_ARCHIVE_DIR set (local runs): files in that folder, same keys.
 * - Neither: no copy is kept (logged once per run by the caller's result: rawKey = null).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { rawArchiveKey, type RawArchive, type RawSource } from "@outbreak/pipeline";

export class S3RawArchive implements RawArchive {
  private readonly s3 = new S3Client({});
  constructor(private readonly bucket: string) {}

  async save(source: RawSource, day: string, body: unknown): Promise<string> {
    const key = rawArchiveKey(source, day);
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: JSON.stringify(body), ContentType: "application/json" }));
    return `s3://${this.bucket}/${key}`;
  }
}

export class LocalDirRawArchive implements RawArchive {
  constructor(private readonly dir: string) {}

  async save(source: RawSource, day: string, body: unknown): Promise<string> {
    const path = join(this.dir, rawArchiveKey(source, day));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(body));
    return path;
  }
}

export function getRawArchive(): RawArchive | undefined {
  if (process.env.RAW_BUCKET) return new S3RawArchive(process.env.RAW_BUCKET);
  if (process.env.RAW_ARCHIVE_DIR) return new LocalDirRawArchive(process.env.RAW_ARCHIVE_DIR);
  return undefined;
}
