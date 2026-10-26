import { Global, Module } from '@nestjs/common'
import { parseEnv } from '@poof/nest'
import { Env } from './env.js'

@Global()
@Module({ providers: [{ provide: Env, useFactory: () => parseEnv(Env, process.env) }], exports: [Env] })
export class ConfigModule {}
