import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { MAX_UPLOAD_BYTES, type StoredFileInfo } from '@icon/contracts';

import type { Principal } from '../access/principal.js';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import { AppException } from '../common/app-exception.js';
import { FilesService } from './files.service.js';

/** In-memory upload, size-limited before buffering completes. */
export const uploadInterceptor = FileInterceptor('file', {
  limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 1, fields: 5 },
});

@ApiTags('files')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('jobs.create')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(uploadInterceptor)
  upload(
    @CurrentPrincipal() principal: Principal,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<StoredFileInfo> {
    if (!file) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Attach a file in the "file" field',
      );
    }
    return this.files.upload(
      principal.organizationId,
      { kind: 'user', userId: principal.userId },
      file.buffer,
      file.originalname,
    );
  }
}
