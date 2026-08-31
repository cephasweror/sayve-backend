/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Only pick up .test.ts files
  testMatch: ['**/tests/**/*.test.ts'],

  // ts-jest transform config — use the app's own tsconfig but override
  // moduleResolution so Jest can resolve imports without "node16" strictness
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'CommonJS',
          moduleResolution: 'node',
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
        },
      },
    ],
  },

  // Give async LLM-dependent tests enough time (mock fallback is synchronous, but be safe)
  testTimeout: 15000,

  // Clear mocks between tests
  clearMocks: true,

  // Show individual test names in output
  verbose: true,
};
