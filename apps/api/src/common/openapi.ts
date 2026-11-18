import type { ApiResponseSchemaHost } from '@nestjs/swagger';
import { z } from 'zod';

export type OpenApiSchema = ApiResponseSchemaHost['schema'];

/**
 * Converts a shared Zod contract into an OpenAPI 3.0 schema so the generated
 * API documentation is derived from the same schemas the clients use.
 */
export function toOpenApiSchema(schema: z.ZodType): OpenApiSchema {
  // Zod emits a JSON-Schema object for the OpenAPI 3.0 target; the two type
  // definitions are structurally compatible but declared independently.
  return z.toJSONSchema(schema, { target: 'openapi-3.0' }) as unknown as OpenApiSchema;
}
