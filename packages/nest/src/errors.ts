import {
  Catch,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  type ArgumentsHost,
} from '@nestjs/common'
import { BaseExceptionFilter } from '@nestjs/core'

export class NotFoundError extends Error {}

export class ConflictError extends Error {}

export class UnavailableError extends Error {}

type DomainError = NotFoundError | ConflictError | UnavailableError

@Catch(NotFoundError, ConflictError, UnavailableError)
export class DomainErrorFilter extends BaseExceptionFilter {
  override catch(error: DomainError, host: ArgumentsHost): void {
    super.catch(toHttp(error), host)
  }
}

function toHttp(error: DomainError) {
  if (error instanceof NotFoundError) return new NotFoundException(error.message)
  if (error instanceof ConflictError) return new ConflictException(error.message)
  return new ServiceUnavailableException(error.message)
}

export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
