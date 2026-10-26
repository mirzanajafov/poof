import { Body, Controller, Get, Headers, HttpCode, Post, Res } from '@nestjs/common'
import { extract } from '@poof/tracing'
import type { Response } from 'express'
import { Scheduler, type SubmitResult } from './scheduler.service.js'
import { SubmitTask } from './submit-task.dto.js'

@Controller()
export class SchedulerController {
  constructor(private readonly scheduler: Scheduler) {}

  @Post('tasks')
  @HttpCode(201)
  async submit(
    @Body() body: SubmitTask,
    @Headers() headers: Record<string, string>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SubmitResult> {
    const result = await this.scheduler.submit(body, { trace: extract(headers) })
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
