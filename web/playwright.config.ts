import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Assumes `make dev` is already running. Set reuseExistingServer so tests
  // don't try to start a second instance.
  webServer: [
    {
      command: 'cd ../api && dotnet run',
      url: 'http://localhost:5000/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm start',
      url: 'http://localhost:4200',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
