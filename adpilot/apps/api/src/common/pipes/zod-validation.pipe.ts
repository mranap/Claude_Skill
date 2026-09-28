import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from '../errors/app-error';

/**
 * Validates and normalises a request payload with a zod schema. Unknown keys are stripped by the schemas
 * (zod objects are non-passthrough by default), types are coerced where the schema says so.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw AppError.validation(
        'Some fields are invalid',
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })),
      );
    }
    return result.data;
  }
}

/** Shorthand: `@Body(zod(schema)) body: Input`. */
export function zod<T>(schema: ZodType<T>): ZodValidationPipe<T> {
  return new ZodValidationPipe(schema);
}
