import { exhibitDefaults } from '@poof/contracts'
import { exhibitPolicyNames, type ExhibitPolicyName } from '@poof/core'
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator'

export class StartExhibit {
  @IsIn(exhibitPolicyNames)
  policy: ExhibitPolicyName

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(900)
  durationSeconds: number = exhibitDefaults.durationSeconds

  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(3)
  utilization: number = exhibitDefaults.utilization

  @IsOptional()
  @IsString()
  dataset: string = exhibitDefaults.dataset

  @IsOptional()
  @IsInt()
  seed: number = exhibitDefaults.seed
}
