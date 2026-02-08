import { ClassicLevel } from "classic-level";
import fs from "fs-extra";
import path from "path";
import crypto from "crypto";

export async function readAllEntries(
  dbPath: string
): Promise<Map<string, string>> {
  const tempDir = path.join(
    process.cwd(),
    ".temp",
    crypto.randomUUID()
  );

  await fs.ensureDir(tempDir);
  await fs.copy(dbPath, tempDir);

  const db = new ClassicLevel(tempDir, {
    keyEncoding: "utf8",
    valueEncoding: "utf8",
  });

  const entries = new Map<string, string>();

  try {
    await db.open();

    for await (const [key, value] of db.iterator()) {
      entries.set(key, value);
    }
  } finally {
    await db.close().catch(() => {});
    await fs.remove(tempDir).catch(() => {});
  }

  return entries;
}

export async function readAllEntriesRaw(
  dbPath: string
): Promise<Map<string, Buffer>> {
  const tempDir = path.join(
    process.cwd(),
    ".temp",
    crypto.randomUUID()
  );

  await fs.ensureDir(tempDir);
  await fs.copy(dbPath, tempDir);

  const db = new ClassicLevel(tempDir, {
    keyEncoding: "utf8",
    valueEncoding: "buffer",
  });

  const entries = new Map<string, Buffer>();

  try {
    await db.open();

    for await (const [key, value] of db.iterator()) {
      entries.set(key, value as unknown as Buffer);
    }
  } finally {
    await db.close().catch(() => {});
    await fs.remove(tempDir).catch(() => {});
  }

  return entries;
}
