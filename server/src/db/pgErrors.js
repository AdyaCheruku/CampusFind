/**
 * Map PostgreSQL errors to HTTP responses. Business-rule errors raised by our
 * functions/triggers use custom SQLSTATEs (CF001..CF008) and carry a message
 * that is already safe and friendly for end users.
 */
const CUSTOM = {
  CF001: 409, // report locked
  CF002: 422, // active report limit
  CF003: 409, // invalid status transition
  CF004: 404, // not found / not yours
  CF005: 409, // invalid state for this action
  CF006: 403, // forbidden
  CF007: 429, // rate limit
  CF008: 422, // validation
};

const UNIQUE_MESSAGES = {
  users_email_lower_uq: 'An account with this email already exists',
  users_roll_no_upper_uq: 'An account with this roll number already exists',
  verification_questions_item_id_question_text_key: 'This question already exists for the item',
  ownership_claims_one_active_per_item_uq: 'Another claim for this item is already active',
  ownership_claims_one_open_per_report_uq: 'This report already has an open claim',
};

export function mapPgError(err) {
  if (!err || typeof err.code !== 'string') return null;

  if (CUSTOM[err.code]) {
    return { status: CUSTOM[err.code], message: err.message, code: err.code };
  }
  switch (err.code) {
    case '42501':
      return { status: 403, message: 'You are not permitted to perform this action', code: err.code };
    case '23505':
      return { status: 409, message: UNIQUE_MESSAGES[err.constraint] || 'This record already exists', code: err.code };
    case '23514':
      return { status: 422, message: `Invalid value (${err.constraint || 'check constraint'})`, code: err.code };
    case '23502':
      return { status: 422, message: `Missing required field: ${err.column}`, code: err.code };
    case '23503':
      return { status: 422, message: 'A referenced record does not exist', code: err.code };
    case '22P02':
    case '22007':
    case '22008':
      return { status: 400, message: 'Invalid input format', code: err.code };
    case '55P03':
    case '40001':
    case '40P01':
      return { status: 503, message: 'The record is busy, please try again', code: err.code };
    default:
      return null;
  }
}
