// XL-013 / JS-AUTH-001 negative fixture.
// Signed algorithm + verify called with an explicit key + short expiry.
// The expiresIn keeps the new CWE-613 auth-noexpiry check from firing on
// this otherwise-well-formed jwt.sign call.
import jwt from 'jsonwebtoken';

const signingKey = process.env.JWT_SECRET;

export function issue(payload) {
  return jwt.sign(payload, signingKey, { algorithm: 'HS256', expiresIn: '15m' });
}

export function check(token) {
  return jwt.verify(token, signingKey);
}
