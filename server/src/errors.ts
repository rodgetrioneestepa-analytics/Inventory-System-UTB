export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function requireThat(condition: unknown, message: string, status = 422): asserts condition {
  if (!condition) throw new AppError(status, message);
}
