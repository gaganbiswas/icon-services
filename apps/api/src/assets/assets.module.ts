import { Global, Module } from '@nestjs/common';

import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';

@Global()
@Module({ controllers: [AssetsController], providers: [AssetsService], exports: [AssetsService] })
export class AssetsModule {}
