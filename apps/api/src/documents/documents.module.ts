import { Global, Module } from '@nestjs/common';

import { DocumentsService } from './documents.service.js';
import { PdfRenderer } from './pdf-renderer.service.js';

@Global()
@Module({ providers: [PdfRenderer, DocumentsService], exports: [DocumentsService, PdfRenderer] })
export class DocumentsModule {}
