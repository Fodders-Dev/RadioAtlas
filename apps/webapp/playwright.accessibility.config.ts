import { defineConfig } from '@playwright/test';
import functionalConfig from './playwright.config';

export default defineConfig({
  ...functionalConfig,
  testDir: './tests',
  testMatch: '**/accessibility-pilot.spec.ts',
  testIgnore: [],
  workers: 1,
  fullyParallel: false,
  outputDir: '../../.tmp/quality-experiments/accessibility/results',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: '../../.tmp/quality-experiments/accessibility/report' }]
  ]
});
