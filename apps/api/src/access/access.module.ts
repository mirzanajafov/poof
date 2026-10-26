import { Module } from '@nestjs/common'
import { AdminToken } from './admin-token.js'

@Module({ providers: [AdminToken], exports: [AdminToken] })
export class AccessModule {}
