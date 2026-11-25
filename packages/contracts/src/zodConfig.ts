// Imported first by every schema module. Zod compiles object parsers with
// `new Function` and probes for it once; the frontend's CSP has no
// 'unsafe-eval', and the browser reports even the caught probe as a CSP
// violation. Zod reads this flag when a schema is built, so it is set before
// any schema exists.
import { config } from 'zod';

config({ jitless: true });
