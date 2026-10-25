import { copyFile, link, rename } from 'node:fs/promises'

export async function linkOrCopy(source: string, target: string): Promise<void> {
  const temp = `${target}.${process.pid}.tmp`
  await link(source, temp).catch(() => copyFile(source, temp))
  await rename(temp, target)
}
