import { copyFile, link, rm } from 'node:fs/promises'

export async function linkOrCopy(source: string, target: string): Promise<void> {
  await rm(target, { force: true })
  await link(source, target).catch(() => copyFile(source, target))
}
