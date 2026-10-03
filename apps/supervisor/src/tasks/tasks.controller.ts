import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common'
import { presets, type PresetName } from '@poof/imaging'
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator'
import type { Response } from 'express'
import { Scheduler, type SubmitResult } from '../scheduler/scheduler.service.js'

export class SubmitTask {
  @IsString()
  dataset: string

  @IsIn(Object.keys(presets))
  preset: PresetName

  @IsNumber()
  @Min(1)
  @Max(86_400)
  deadlineSeconds: number

  @IsOptional()
  @IsInt()
  @Min(1)
  count?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number
}

@Controller()
export class TasksController {
  constructor(private readonly scheduler: Scheduler) {}

  @Post('tasks')
  @HttpCode(201)
  async submit(@Body() body: SubmitTask, @Res({ passthrough: true }) res: Response): Promise<SubmitResult> {
    const result = await this.scheduler.submit(body)
    if (!result.accepted) {
      res.status(result.code)
      res.setHeader('Retry-After', String(result.retryAfterSeconds))
    }
    return result
  }

  @Get('health')
  health() {
    return this.scheduler.health()
  }

  @Get('state')
  state() {
    return this.scheduler.snapshot()
  }
}
