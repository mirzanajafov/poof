import { Body, Controller, Delete, Get, Headers, NotFoundException, Post } from '@nestjs/common'
import { presets, type PresetName } from '@poof/imaging'
import { extract } from '@poof/tracing'
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator'
import { exhibitPolicies, Exhibits, type ExhibitParams } from './exhibits.service.js'

export class StartExhibit {
  @IsIn(Object.keys(exhibitPolicies))
  policy: string

  @IsInt()
  @Min(10)
  @Max(900)
  durationSeconds: number

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(5)
  utilization?: number

  @IsOptional()
  @IsString()
  dataset?: string

  @IsOptional()
  @IsIn(Object.keys(presets))
  preset?: PresetName

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  minItems?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxItems?: number

  @IsOptional()
  @IsNumber()
  @Min(0.05)
  slackMin?: number

  @IsOptional()
  @IsNumber()
  @Min(0.05)
  slackMax?: number

  @IsOptional()
  @IsInt()
  seed?: number
}

@Controller('exhibits')
export class ExhibitsController {
  constructor(private readonly exhibits: Exhibits) {}

  @Post()
  start(@Body() body: StartExhibit, @Headers() headers: Record<string, string>) {
    const params: ExhibitParams = {
      policy: body.policy,
      durationSeconds: body.durationSeconds,
      utilization: body.utilization ?? 1,
      dataset: body.dataset ?? 'synthetic',
      preset: body.preset ?? 'webp-1600',
      minItems: body.minItems ?? 20,
      maxItems: Math.max(body.maxItems ?? 120, body.minItems ?? 20),
      slackMin: body.slackMin ?? 0.5,
      slackMax: Math.max(body.slackMax ?? 3, body.slackMin ?? 0.5),
      seed: body.seed ?? 1,
    }
    return this.exhibits.start(params, extract(headers))
  }

  @Get('current')
  current() {
    const state = this.exhibits.state()
    if (!state) throw new NotFoundException('no exhibit is running')
    return state
  }

  @Delete('current')
  async abort() {
    const stats = await this.exhibits.finish('ABORTED')
    if (!stats) throw new NotFoundException('no exhibit is running')
    return stats
  }
}
