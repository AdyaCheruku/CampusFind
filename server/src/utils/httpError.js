export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
export const badRequest = (msg) => new HttpError(400, msg);
export const forbidden = (msg = 'You do not have access to this resource') => new HttpError(403, msg);

/** Parse a positive integer route parameter or throw 404. */
export function idParam(value, what = 'Resource') {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw notFound(what);
  return n;
}
