// XL-006 / JS-SECRET-001 positive fixture.
// Uses AWS's own published example key id (AKIAIOSFODNN7EXAMPLE) so the
// fixture matches the SECRET_PATTERNS AWS regex without being a live
// credential or tripping push protection.
const awsConfig = {
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
};

export function makeClient() {
  return awsConfig;
}
