import {
  BadGatewayException,
  Catch,
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type ArgumentsHost,
} from '@nestjs/common'
import { BaseExceptionFilter } from '@nestjs/core'

export class NotFoundError extends Error {}

export class ConflictError extends Error {}

export class UnavailableError extends Error {}

export class UpstreamError extends Error {}

type DomainError = NotFoundError | ConflictError | UnavailableError | UpstreamError

@Catch(NotFoundError, ConflictError, UnavailableError, UpstreamError)
export class DomainErrorFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(DomainErrorFilter.name)

  override catch(error: DomainError, host: ArgumentsHost): void {
    if (error instanceof UnavailableError || error instanceof UpstreamError)
      this.logger.error(error.message, error.cause)
    super.catch(toHttp(error), host)
  }
}

function toHttp(error: DomainError) {
  if (error instanceof NotFoundError) return new NotFoundException(error.message)
  if (error instanceof ConflictError) return new ConflictException(error.message)
  if (error instanceof UpstreamError) return new BadGatewayException(error.message)
  return new ServiceUnavailableException(error.message)
}
