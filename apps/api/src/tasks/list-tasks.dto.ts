import { TaskStatus } from '@poof/db'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'

export class ListTasks {
  @IsOptional()
  @IsIn(Object.values(TaskStatus))
  status?: TaskStatus

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50
}
