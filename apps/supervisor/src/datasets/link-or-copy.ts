import { copyFile, link, rename, rm, stat } from 'node:fs/promises'

export async function linkOrCopy(source: string, target: string): Promise<void> {
  await link(source, target).catch(() => copyFile(source, target))
}

async function sameFile(a: string, b: string): Promise<boolean> {
  const [first, second] = await Promise.all([stat(a), stat(b).catch(() => null)])
  return second !== null && first.dev === second.dev && first.ino === second.ino
}

export async function replaceWithLinkOrCopy(source: string, target: string): Promise<void> {
  if (await sameFile(source, target)) return
  const temp = `${target}.${process.pid}.tmp`
  await rm(temp, { force: true })
  await linkOrCopy(source, temp)
  await rename(temp, target)
}
