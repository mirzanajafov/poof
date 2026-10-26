import 'reflect-metadata'
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator'

export class Env {
  @IsString()
  DATABASE_URL: string

  @IsString()
  REDIS_URL: string

  @IsString()
  SUPERVISOR_URL: string

  @IsOptional()
  @IsString()
  OTEL_EXPORTER_OTLP_ENDPOINT?: string

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
