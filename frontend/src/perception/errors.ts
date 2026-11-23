import type { PerceptionErrorCode } from './protocol';

export class PerceptionError extends Error {
  readonly code: PerceptionErrorCode;

  constructor(code: PerceptionErrorCode, detail: string) {
    super(detail);
    this.name = 'PerceptionError';
    this.code = code;
  }
}
