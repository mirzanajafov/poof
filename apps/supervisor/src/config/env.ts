import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { IsInt, IsNumber, IsOptional, IsString, Max, Min, validateSync } from 'class-validator'

export class Env {
  @IsString()
  DATABASE_URL: string

  @IsString()
  REDIS_URL: string

  @IsString()
  DATA_DIR: string

  @IsOptional()
  @IsInt()
  @Min(1)
  PORT: number = 3110

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(64)
  BUDGET: number = 2

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  CAPACITY_CORES: number = 1.32

  @IsOptional()
  @IsInt()
  @Min(1)
  CHUNK_ITEMS: number = 10

  @IsOptional()
  @IsInt()
  @Min(1)
  MAX_ATTEMPTS: number = 3

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  DEAD_LETTER_SHARE: number = 0.05

  @IsOptional()
  @IsInt()
  @Min(1)
  RECYCLE_ITEMS: number = 2000

  @IsOptional()
  @IsInt()
  @Min(32)
  WORKER_RSS_MB: number = 512

  @IsOptional()
  @IsInt()
  @Min(100)
  CHECKPOINT_MS: number = 2000

  @IsOptional()
  @IsInt()
  @Min(1)
  MAX_TASK_ITEMS: number = 2000

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(256)
  EXHIBIT_MAX_PROCESSES: number = 35
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, { enableImplicitConversion: true })
  const errors = validateSync(env, { skipMissingProperties: false })
  if (errors.length > 0) {
    throw new Error(errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`).join('; '))
  }
  return env
}
