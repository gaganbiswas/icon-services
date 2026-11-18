import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  type LivenessResponse,
  LivenessResponseSchema,
  type ReadinessResponse,
  ReadinessResponseSchema,
} from '@icon/contracts';
import type { Response } from 'express';

import { toOpenApiSchema } from '../common/openapi.js';
import { HealthService } from './health.service.js';

const livenessSchema = toOpenApiSchema(LivenessResponseSchema);
const readinessSchema = toOpenApiSchema(ReadinessResponseSchema);

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness: the API process is running.' })
  @ApiResponse({ status: HttpStatus.OK, schema: livenessSchema })
  live(): LivenessResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: required dependencies are reachable.' })
  @ApiResponse({ status: HttpStatus.OK, schema: readinessSchema })
  @ApiResponse({ status: HttpStatus.SERVICE_UNAVAILABLE, schema: readinessSchema })
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponse> {
    const result = await this.health.readiness();
    response.status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
