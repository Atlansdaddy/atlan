// src/lib/probes/v05/adapters/index.js
//
// Language-specific adapter records aggregated for the manifest.
//   - python/*   : Phase 1 (XL-001/002/004/006), independent detection
//   - javascript/*: Phase 2 migration of overlapping v0.4 probes
//                    (Secret Scanner, SQL Injection, Auth Weakness) with
//                    legacy_finding_id_seed for stableId continuity

import { PY_DESERIALIZE_001 } from './python/py-deserialize-001-unsafe-load.js';
import { PY_SQL_RAW_001 } from './python/py-sql-raw-001-interpolation.js';
import { PY_TLS_VERIFY_001 } from './python/py-tls-verify-001-disabled.js';
import { PY_SECRETS_001 } from './python/py-secrets-001-hardcoded-key.js';
import { JS_SECRET_001 } from './javascript/js-secret-001-hardcoded.js';
import { JS_SQL_RAW_001 } from './javascript/js-sql-raw-001-template-literal.js';
import { JS_AUTH_001 } from './javascript/js-auth-001-token-verification.js';
import { RS_DESERIALIZE_001 } from './rust/rs-deserialize-001-untrusted.js';
import { RS_SQL_RAW_001 } from './rust/rs-sql-raw-001-format.js';
import { RS_TLS_VERIFY_001 } from './rust/rs-tls-verify-001-danger.js';
import { RS_SECRETS_001 } from './rust/rs-secrets-001-hardcoded.js';
import { GO_DESERIALIZE_001 } from './go/go-deserialize-001-untrusted.js';
import { GO_SQL_RAW_001 } from './go/go-sql-raw-001-sprintf.js';
import { GO_TLS_VERIFY_001 } from './go/go-tls-verify-001-insecure.js';
import { GO_SECRETS_001 } from './go/go-secrets-001-hardcoded.js';
import { JV_DESERIALIZE_001 } from './java/jv-deserialize-001-objectinputstream.js';
import { JV_SQL_RAW_001 } from './java/jv-sql-raw-001-concat.js';
import { JV_TLS_VERIFY_001 } from './java/jv-tls-verify-001-trustall.js';
import { JV_SECRETS_001 } from './java/jv-secrets-001-hardcoded.js';
import { C_SQL_RAW_001 } from './c/c-sql-raw-001-mprintf.js';
import { C_TLS_VERIFY_001 } from './c/c-tls-verify-001-sslnone.js';
import { C_SECRETS_001 } from './c/c-secrets-001-hardcoded.js';
import { CPP_SQL_RAW_001 } from './cpp/cpp-sql-raw-001-qstring.js';
import { CPP_TLS_VERIFY_001 } from './cpp/cpp-tls-verify-001-sslnone.js';
import { CPP_SECRETS_001 } from './cpp/cpp-secrets-001-hardcoded.js';
import { CS_DESERIALIZE_001 } from './csharp/cs-deserialize-001-binaryformatter.js';
import { CS_SQL_RAW_001 } from './csharp/cs-sql-raw-001-sqlcommand.js';
import { CS_TLS_VERIFY_001 } from './csharp/cs-tls-verify-001-certcallback.js';
import { CS_SECRETS_001 } from './csharp/cs-secrets-001-hardcoded.js';
import { CS_AUTH_001 } from './csharp/cs-auth-001-tokenvalidation.js';
import { KT_SQL_RAW_001 } from './kotlin/kt-sql-raw-001-room.js';
import { KT_TLS_VERIFY_001 } from './kotlin/kt-tls-verify-001-trustall.js';
import { KT_SECRETS_001 } from './kotlin/kt-secrets-001-hardcoded.js';
import { KT_AUTH_001 } from './kotlin/kt-auth-001-jjwt-unsigned.js';
import { SW_SQL_RAW_001 } from './swift/sw-sql-raw-001-interpolation.js';
import { SW_TLS_VERIFY_001 } from './swift/sw-tls-verify-001-trustall.js';
import { SW_SECRETS_001 } from './swift/sw-secrets-001-hardcoded.js';
import { RB_DESERIALIZE_001 } from './ruby/rb-deserialize-001-marshal.js';
import { RB_SQL_RAW_001 } from './ruby/rb-sql-raw-001-where.js';
import { RB_TLS_VERIFY_001 } from './ruby/rb-tls-verify-001-verifynone.js';
import { RB_SECRETS_001 } from './ruby/rb-secrets-001-hardcoded.js';
import { PHP_DESERIALIZE_001 } from './php/php-deserialize-001-unserialize.js';
import { PHP_SQL_RAW_001 } from './php/php-sql-raw-001-concat.js';
import { PHP_TLS_VERIFY_001 } from './php/php-tls-verify-001-curlopt.js';
import { PHP_SECRETS_001 } from './php/php-secrets-001-hardcoded.js';
import { SC_DESERIALIZE_001 } from './scala/sc-deserialize-001-objectinput.js';
import { SC_SQL_RAW_001 } from './scala/sc-sql-raw-001-interpolation.js';
import { SC_TLS_VERIFY_001 } from './scala/sc-tls-verify-001-trustall.js';
import { SC_SECRETS_001 } from './scala/sc-secrets-001-hardcoded.js';
import { EX_DESERIALIZE_001 } from './elixir/ex-deserialize-001-binarytoterm.js';
import { EX_SQL_RAW_001 } from './elixir/ex-sql-raw-001-fragment.js';
import { EX_TLS_VERIFY_001 } from './elixir/ex-tls-verify-001-verifynone.js';
import { EX_SECRETS_001 } from './elixir/ex-secrets-001-hardcoded.js';
import { DA_SQL_RAW_001 } from './dart/da-sql-raw-001-rawquery.js';
import { DA_TLS_VERIFY_001 } from './dart/da-tls-verify-001-badcert.js';
import { DA_SECRETS_001 } from './dart/da-secrets-001-hardcoded.js';

/** @type {object[]} */
export const ADAPTERS = [
  PY_DESERIALIZE_001,
  PY_SQL_RAW_001,
  PY_TLS_VERIFY_001,
  PY_SECRETS_001,
  JS_SECRET_001,
  JS_SQL_RAW_001,
  JS_AUTH_001,
  RS_DESERIALIZE_001,
  RS_SQL_RAW_001,
  RS_TLS_VERIFY_001,
  RS_SECRETS_001,
  GO_DESERIALIZE_001,
  GO_SQL_RAW_001,
  GO_TLS_VERIFY_001,
  GO_SECRETS_001,
  JV_DESERIALIZE_001,
  JV_SQL_RAW_001,
  JV_TLS_VERIFY_001,
  JV_SECRETS_001,
  C_SQL_RAW_001,
  C_TLS_VERIFY_001,
  C_SECRETS_001,
  CPP_SQL_RAW_001,
  CPP_TLS_VERIFY_001,
  CPP_SECRETS_001,
  CS_DESERIALIZE_001,
  CS_SQL_RAW_001,
  CS_TLS_VERIFY_001,
  CS_SECRETS_001,
  CS_AUTH_001,
  KT_SQL_RAW_001,
  KT_TLS_VERIFY_001,
  KT_SECRETS_001,
  KT_AUTH_001,
  SW_SQL_RAW_001,
  SW_TLS_VERIFY_001,
  SW_SECRETS_001,
  RB_DESERIALIZE_001,
  RB_SQL_RAW_001,
  RB_TLS_VERIFY_001,
  RB_SECRETS_001,
  PHP_DESERIALIZE_001,
  PHP_SQL_RAW_001,
  PHP_TLS_VERIFY_001,
  PHP_SECRETS_001,
  SC_DESERIALIZE_001,
  SC_SQL_RAW_001,
  SC_TLS_VERIFY_001,
  SC_SECRETS_001,
  EX_DESERIALIZE_001,
  EX_SQL_RAW_001,
  EX_TLS_VERIFY_001,
  EX_SECRETS_001,
  DA_SQL_RAW_001,
  DA_TLS_VERIFY_001,
  DA_SECRETS_001,
];
