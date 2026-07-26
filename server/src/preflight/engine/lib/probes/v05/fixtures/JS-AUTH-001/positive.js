// XL-013 / JS-AUTH-001 positive fixture.
// alg:none lets anyone forge a token; jwt.verify with no key skips signature
// verification. Either line is a finding.
import jwt from 'jsonwebtoken';

export function issue(payload) {
  return jwt.sign(payload, null, { algorithm: 'none' });
}

export function check(token) {
  return jwt.verify(token);
}
