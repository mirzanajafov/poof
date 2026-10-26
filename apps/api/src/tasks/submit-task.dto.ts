import { presetNames, type PresetName } from '@poof/core'
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator'

export class SubmitTask {
  @IsString()
  dataset: string

  @IsIn(presetNames)
  preset: PresetName

  @IsNumber()
  @Min(1)
  @Max(3600)
  deadlineSeconds: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  count?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number
}
