// XL-006 / JS-SECRET-001 negative fixture.
// The credential is read from the environment; no literal in source.
const awsConfig = {
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
};

export function makeClient() {
  return awsConfig;
}
