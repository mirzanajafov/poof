import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'

export function parseEnv<T extends object>(type: new () => T, raw: Record<string, unknown>): T {
  const env = plainToInstance(type, raw, { enableImplicitConversion: true })
  const errors = validateSync(env)
  if (errors.length > 0) {
    throw new Error(errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`).join('; '))
  }
  return env
}
