import 'reflect-metadata'
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator'

export class Env {
  @IsString()
  readonly DATABASE_URL: string

  @IsString()
  readonly REDIS_URL: string

  @IsString()
  readonly SUPERVISOR_URL: string

  @IsOptional()
  @IsString()
  readonly OTEL_EXPORTER_OTLP_ENDPOINT?: string

  @IsString()
  readonly DATA_DIR: string

  @IsString()
  @MinLength(24)
  readonly ADMIN_TOKEN: string

  @IsOptional()
  @IsInt()
  @Min(1)
  readonly PORT: number = 3111

  @IsOptional()
  @IsString()
  readonly TRUST_PROXY: string = 'loopback'

  @IsOptional()
  @IsString()
  readonly WEB_ORIGIN: string = 'http://localhost:3112'

  @IsOptional()
  @IsInt()
  @Min(1)
  readonly TASKS_PER_MINUTE: number = 10

  @IsOptional()
  @IsInt()
  @Min(1)
  readonly EXHIBITS_PER_HOUR: number = 3

  @IsOptional()
  @IsInt()
  @Min(0)
  readonly EXHIBIT_COOLDOWN_SECONDS: number = 120

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(900)
  readonly PUBLIC_EXHIBIT_SECONDS: number = 60
}
