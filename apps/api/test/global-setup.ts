import { createTestDatabase } from '@poof/db/testing'
import type { TestProject } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
  }
}

export default async function setup(project: TestProject) {
  const database = await createTestDatabase()
  project.provide('databaseUrl', database.url)
  return () => database.drop()
}
