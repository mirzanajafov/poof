import { copyFile, link, rename, rm, stat } from 'node:fs/promises'

export async function linkOrCopy(source: string, target: string): Promise<void> {
  await link(source, target).catch(() => copyFile(source, target))
}

export async function replaceFile(target: string, write: (temp: string) => Promise<void>): Promise<void> {
  const temp = `${target}.${process.pid}.tmp`
  await rm(temp, { force: true })
  try {
    await write(temp)
    await rename(temp, target)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

async function sameFile(a: string, b: string): Promise<boolean> {
  const [first, second] = await Promise.all([stat(a, { bigint: true }), stat(b, { bigint: true }).catch(() => null)])
  return second !== null && first.ino !== 0n && first.dev === second.dev && first.ino === second.ino
}

export async function replaceWithLinkOrCopy(source: string, target: string): Promise<void> {
  if (await sameFile(source, target)) return
  await replaceFile(target, (temp) => linkOrCopy(source, temp))
}
