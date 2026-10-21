export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string) => new ApiError(400, code, message);
export const unauthorized = (code = 'UNAUTHORIZED', message = 'Authentication required') =>
  new ApiError(401, code, message);
export const forbidden = (code: string, message: string) => new ApiError(403, code, message);
export const notFound = (what: string) => new ApiError(404, `${what.toUpperCase()}_NOT_FOUND`, `${what} not found`);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const tooManyRequests = (code: string, message: string) => new ApiError(429, code, message);
