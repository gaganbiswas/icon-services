import { type DynamicModule, Global, Module } from '@nestjs/common';

import type { Env } from './env.js';

/** DI token for the validated environment. */
export const APP_ENV = Symbol('APP_ENV');

@Global()
@Module({})
export class AppConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppConfigModule,
      providers: [{ provide: APP_ENV, useValue: Object.freeze({ ...env }) }],
      exports: [APP_ENV],
    };
  }
}
