import { Module } from '@nestjs/common'
import { TaskStore } from './task-store.js'

@Module({ providers: [TaskStore], exports: [TaskStore] })
export class TasksModule {}
