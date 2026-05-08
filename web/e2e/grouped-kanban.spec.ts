import { test, expect, Page } from '@playwright/test';

// Requires: make dev + make reset && make hash-pw

async function loginAs(page: Page, username: string) {
  await page.goto('/login');
  await page.locator('input[type="text"]').fill(username);
  await page.locator('input[type="password"]').fill('nee2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/kanban/, { timeout: 10_000 });
}

test.describe('E23 card drawer', () => {
  test('opens drawer with task list and PDF pane when card is clicked', async ({ page }) => {
    await loginAs(page, 'supervisor');

    const firstCard = page.locator('app-station-card').first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    await firstCard.click();

    await expect(page.locator('.drawer-bg')).toBeVisible();
    await expect(page.locator('.drawer-head-ro')).toBeVisible();
    await expect(page.locator('.task-list-full')).toBeVisible();
    await expect(page.locator('.task-row').first()).toBeVisible();

    // Right pane shows either the PDF iframe (after deferred load) or the empty state
    await expect(
      page.locator('.pdf-frame').or(page.locator('.pdf-empty')),
    ).toBeVisible({ timeout: 2_000 });
  });

  test('shows empty PDF state when no source PDF has been uploaded', async ({ page }) => {
    await loginAs(page, 'supervisor');

    // Seed data cards have no source PDF — find one where View PDF is disabled
    const cardWithNoPdf = page.locator('app-station-card').filter({
      has: page.locator('.stn-pdf-btn[disabled]'),
    }).first();
    await expect(cardWithNoPdf).toBeVisible({ timeout: 10_000 });
    await cardWithNoPdf.click();

    await expect(page.locator('.drawer-bg')).toBeVisible();
    await expect(page.locator('.pdf-empty')).toBeVisible();
    await expect(page.locator('.pdf-empty-title')).toHaveText('No source PDF on file');
    await expect(page.locator('.pdf-empty-link')).toBeVisible();
  });

  test('Escape key closes the drawer', async ({ page }) => {
    await loginAs(page, 'supervisor');

    const firstCard = page.locator('app-station-card').first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    await firstCard.click();

    await expect(page.locator('.drawer-bg')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.drawer-bg')).not.toBeVisible();
  });
});
