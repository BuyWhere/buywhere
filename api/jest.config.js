/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    // prevent ioredis from trying to connect during tests
  },
  collectCoverageFrom: [
    'src/routes/auth.ts',
    'src/routes/products.ts',
    'src/routes/categories.ts',
    'src/middleware/apiKey.ts',
    'src/middleware/agentDetect.ts',
    'src/middleware/queryLog.ts',
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 70,
      statements: 80,
    },
  },
  coverageReporters: ['text', 'lcov', 'json-summary'],
  // Suppress Redis/pg connection noise in test output
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
};
