import { test, expect, Page, devices } from '@playwright/test';
import * as path from 'path';

// Captures the screenshots for the stakeholder pitch deck. Driven by Playwright
// because we already have the toolchain. Run from web/:
//   npx playwright test e2e/capture-deck-screenshots --project=chromium

const ASSETS = path.resolve(__dirname, '..', '..', 'docs', 'decks', 'assets');

async function loginAs(page: Page, username: string) {
  await page.addInitScript(() => {
    localStorage.setItem('nee-theme', 'light');
    sessionStorage.removeItem('kanban.selectedWeek.v2');
  });
  await page.goto('/login');
  await page.locator('input[type="text"]').fill(username);
  await page.locator('input[type="password"]').fill('nee2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|kanban|tech)/, { timeout: 15_000 });
}

test.describe('pitch deck assets', () => {
  test('desktop screenshots', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await loginAs(page, 'supervisor');

    // 1. Kanban board
    await page.goto('/kanban');
    await page.waitForResponse(r => r.url().includes('/api/kanban?') && r.status() === 200);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(ASSETS, '02-kanban.png'), fullPage: false });

    // 2-4. Reports — capture each section as its own image
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Reports' }).click();
    await page.waitForTimeout(1800);

    const variance = page.locator('app-variance-root-cause').first();
    await variance.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await variance.screenshot({ path: path.join(ASSETS, '03-variance.png') });

    const concentration = page.locator('app-customer-concentration').first();
    await concentration.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await concentration.screenshot({ path: path.join(ASSETS, '04-concentration.png') });

    const forecast = page.locator('app-forecast-widget').first();
    await forecast.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await forecast.screenshot({ path: path.join(ASSETS, '05-forecast.png') });

    await ctx.close();
  });

  test('mobile screenshots', async ({ browser }) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13 Pro'] });
    const page = await ctx.newPage();
    await loginAs(page, 'peter');

    await page.goto('/tech/tasks');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(ASSETS, '06-tech-list.png') });

    const firstTask = page.locator('.task-card').first();
    if ((await firstTask.count()) > 0) {
      await firstTask.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(ASSETS, '07-tech-detail.png') });
    }
    await ctx.close();
  });
});
