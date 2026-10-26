import { Module } from '@nestjs/common'
import { Admin } from './admin.js'

@Module({ providers: [Admin], exports: [Admin] })
export class AccessModule {}
