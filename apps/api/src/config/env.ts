import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, Min, MinLength, validateSync } from 'class-validator'

export class Env {
  @IsString()
  DATABASE_URL: string

  @IsString()
  REDIS_URL: string

  @IsString()
  SUPERVISOR_URL: string

  @IsString()
  DATA_DIR: string

  @IsString()
  @MinLength(24)
  ADMIN_TOKEN: string

  @IsOptional()
  @IsInt()
  @Min(1)
  PORT: number = 3111

  @IsOptional()
  @IsString()
  TRUST_PROXY: string = 'loopback'

  @IsOptional()
  @IsString()
  WEB_ORIGIN: string = 'http://localhost:3112'

  @IsOptional()
  @IsInt()
  @Min(1)
  TASKS_PER_MINUTE: number = 10

  @IsOptional()
  @IsInt()
  @Min(1)
  EXHIBITS_PER_HOUR: number = 3

  @IsOptional()
  @IsInt()
  @Min(0)
  EXHIBIT_COOLDOWN_SECONDS: number = 120

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(900)
  PUBLIC_EXHIBIT_SECONDS: number = 60
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, { enableImplicitConversion: true })
  const errors = validateSync(env, { skipMissingProperties: false })
  if (errors.length > 0) {
    throw new Error(errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`).join('; '))
  }
  return env
}
