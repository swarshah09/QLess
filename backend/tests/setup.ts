import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Loaded before each test file's imports so `src/config/env` sees the test
 * configuration when it is first evaluated.
 */
process.env.NODE_ENV = 'test';
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });
