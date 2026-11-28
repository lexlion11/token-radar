// Load playwright-core statically.
//
// Why static: the program that runs must live in the repository, not in an entry
// secret. A dynamic import() of a value read from the environment (PLAYWRIGHT_CORE)
// makes the entry's code run a program it reads from an environment secret, which
// the authorship checks treat as code that was not built in the transcripts and not
// shipped in the repository.
//
// This file is the source file the entry runs directly: capture-screenshots.mjs
// imports it, and it resolves playwright-core from the npm-global tree where this
// entry is built. An environment variable may hold a key, a flag or a path — never
// the program that is imported.

import { chromium } from '/home/lex/.npm-global/lib/node_modules/openclaw/node_modules/playwright-core/index.mjs';

export { chromium };
