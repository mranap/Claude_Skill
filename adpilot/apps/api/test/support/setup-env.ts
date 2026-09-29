import '../../src/bootstrap/polyfills';
import { applyTestEnv } from './test-env';

// Runs before every integration/e2e test file (vitest `setupFiles`), before application modules read the env.
applyTestEnv();
