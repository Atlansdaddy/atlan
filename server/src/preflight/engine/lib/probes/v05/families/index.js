// src/lib/probes/v05/families/index.js
//
// XL family records aggregated for the manifest. XL-001..XL-012 are the
// research corpus families; XL-013 is the Phase 2 Auth Weakness split
// addition (see xl-013-auth-token-verification.js).

import { XL_001 } from './xl-001-unsafe-deserialization.js';
import { XL_002 } from './xl-002-raw-query-interpolation.js';
import { XL_004 } from './xl-004-tls-verification-disabled.js';
import { XL_006 } from './xl-006-hardcoded-secrets.js';
import { XL_013 } from './xl-013-auth-token-verification.js';

/** @type {object[]} */
export const FAMILIES = [XL_001, XL_002, XL_004, XL_006, XL_013];
