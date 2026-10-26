import 'reflect-metadata'
import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator'

export class Env {
  @IsString()
  readonly DATABASE_URL: string

  @IsString()
  readonly REDIS_URL: string

  @IsString()
  readonly DATA_DIR: string

  @IsOptional()
  @IsString()
  readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  readonly PORT: number = 3110

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(64)
  readonly BUDGET: number = 2

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  readonly CAPACITY_CORES: number = 1.32

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  readonly WORKER_CPU_CORES: number = 1.45

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  readonly ADMISSION_PRIOR_RATIO: number = 1.2

  @IsOptional()
  @IsInt()
  @Min(1)
  readonly CHUNK_ITEMS: number = 10

  @IsOptional()
  @IsInt()
  @Min(1)
  readonly MAX_ATTEMPTS: number = 3

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  readonly DEAD_LETTER_SHARE: number = 0.05

  @IsOptional()
  @IsInt()
  @Min(1)
  readonly RECYCLE_ITEMS: number = 2000

  @IsOptional()
  @IsInt()
  @Min(32)
  readonly WORKER_RSS_MB: number = 512

  @IsOptional()
  @IsInt()
  @Min(100)
  readonly CHECKPOINT_MS: number = 2000

  @IsOptional()
  @IsInt()
  @Min(1)
  readonly MAX_TASK_ITEMS: number = 2000

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(256)
  readonly EXHIBIT_MAX_PROCESSES: number = 35

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  readonly OUTPUT_TTL_HOURS: number = 24
}
