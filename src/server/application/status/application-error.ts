export type ApplicationErrorCode =
  | "invalid_input"
  | "unauthorized"
  | "conflict"
  | "not_found"
  | "unavailable"
  | "internal_error";

export class StatusApplicationError extends Error {
  readonly code: ApplicationErrorCode;

  constructor(code: ApplicationErrorCode, message: string) {
    super(message);
    this.name = "StatusApplicationError";
    this.code = code;
  }
}
