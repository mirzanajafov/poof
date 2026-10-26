import { exhibitDefaults, type ExhibitParams } from '@poof/contracts'
import { exhibitPolicyNames, presetNames, type ExhibitPolicyName, type PresetName } from '@poof/core'
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator'

@ValidatorConstraint({ name: 'notBelow' })
class NotBelow implements ValidatorConstraintInterface {
  validate(value: unknown, { object, constraints }: ValidationArguments): boolean {
    const other: unknown = constraints[0]
    const floor: unknown = typeof other === 'string' ? Reflect.get(object, other) : undefined
    return typeof value === 'number' && typeof floor === 'number' && value >= floor
  }

  defaultMessage({ property, constraints }: ValidationArguments): string {
    const other: unknown = constraints[0]
    return `${property} must not be below ${String(other)}`
  }
}

export class StartExhibit implements ExhibitParams {
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
  @Max(5)
  utilization: number = exhibitDefaults.utilization

  @IsOptional()
  @IsString()
  dataset: string = exhibitDefaults.dataset

  @IsOptional()
  @IsIn(presetNames)
  preset: PresetName = exhibitDefaults.preset

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  minItems: number = exhibitDefaults.minItems

  @IsOptional()
  @IsInt()
  @Max(1000)
  @Validate(NotBelow, ['minItems'])
  maxItems: number = exhibitDefaults.maxItems

  @IsOptional()
  @IsNumber()
  @Min(0.05)
  slackMin: number = exhibitDefaults.slackMin

  @IsOptional()
  @IsNumber()
  @Validate(NotBelow, ['slackMin'])
  slackMax: number = exhibitDefaults.slackMax

  @IsOptional()
  @IsInt()
  seed: number = exhibitDefaults.seed
}
