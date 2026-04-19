import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema as zodToJsonSchemaImpl } from 'zod-to-json-schema';

/**
 * Wrap `zod-to-json-schema` so every tool definition emits a JSON schema
 * suitable for the MCP client (object-root, no top-level `$ref`).
 */
export function zodToJsonSchema(schema: ZodTypeAny, name: string): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const result = zodToJsonSchemaImpl(schema, {
    name,
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as Record<string, unknown>;

  // zod-to-json-schema wraps the result in { $ref, definitions } when `name`
  // is provided. Unwrap for MCP which expects the schema inline.
  if (
    'definitions' in result &&
    result.definitions &&
    typeof result.definitions === 'object' &&
    name in (result.definitions as Record<string, unknown>)
  ) {
    return (result.definitions as Record<string, unknown>)[name] as Record<string, unknown>;
  }
  return result;
}
