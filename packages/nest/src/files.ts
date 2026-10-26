import { readdir } from 'node:fs/promises'

export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export async function readDirIfPresent(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch (error) {
    if (isMissingFile(error)) return []
    throw error
  }
}
