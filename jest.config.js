export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true }],
  },
  // Add these configurations:
  testMatch: [
    "<rootDir>/src/**/__tests__/**/*.test.ts"
  ],
  modulePathIgnorePatterns: [
    "<rootDir>/build/"
  ]
};