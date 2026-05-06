import { test, expect } from '@playwright/test';

// Assumes the DB is seeded with standard dev data (make seed).
// Run `make dev` before executing these tests.

async function login(page: any) {
  await page.goto('/login');
  await page.locator('input[type="text"]').fill('sales');
  await page.locator('input[type="password"]').fill('nee2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/sales\/ros/);
}

async function setFutureDate(page: any, daysAhead: number) {
  const future = new Date();
  future.setDate(future.getDate() + daysAhead);
  await page.locator('input[type="date"]').fill(future.toISOString().split('T')[0]);
}

test.describe('Sales — Create RO from template', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('creates RO from TP42N template and lands on detail page with toast', async ({ page }) => {
    await page.getByRole('button', { name: '+ New RO' }).click();
    await expect(page).toHaveURL(/\/sales\/new-ro/);

    // Wait for customer dropdown to load options from API
    await expect(page.locator('select').first().locator('option').nth(1)).not.toBeEmpty();

    // Select customer (first dropdown), job type (second dropdown)
    await page.locator('select').first().selectOption({ label: 'Direct Freight Express' });
    await page.locator('select').nth(1).selectOption({ label: 'New build' });

    // Fill text fields
    await page.locator('input[placeholder="e.g. ABC123"]').fill('TEST01');
    await page.locator('input[placeholder="e.g. Isuzu"]').fill('Isuzu');
    await page.locator('input[placeholder="e.g. NPR75"]').fill('FRR90');
    await setFutureDate(page, 60);

    // Search for and pick TP42N template
    await page.locator('.search-input').fill('tipper');
    await expect(page.locator('.template-card').first()).toBeVisible();
    await page.locator('.template-card', { hasText: 'TP42N' }).click();

    // Verify operations preview
    await expect(page.locator('.ops-header')).toContainText('12 operations');

    // Submit
    await page.getByRole('button', { name: 'Create RO' }).click();

    // Should land on detail page
    await expect(page).toHaveURL(/\/sales\/ro\/[0-9a-f-]+\?created=1/, { timeout: 10_000 });

    // Toast confirmation
    await expect(page.locator('.toast')).toBeVisible();
    await expect(page.locator('.toast')).toContainText('12 tasks');

    // 12 task rows
    await expect(page.locator('.task-row')).toHaveCount(12);

    // Header contains RO number and customer
    await expect(page.locator('.scene-title')).toContainText('RO');
    await expect(page.locator('.scene-title')).toContainText('Direct Freight Express');
  });

  test('shows inline validation errors without submitting when fields are touched and invalid', async ({ page }) => {
    await page.goto('/sales/new-ro');

    // Touch the rego field and leave it blank to trigger inline validation
    await page.locator('input[placeholder="e.g. ABC123"]').click();
    await page.keyboard.press('Tab');

    // Rego error should appear
    await expect(page.locator('.field-error')).toBeVisible();

    // Submit button should remain disabled — form is invalid
    await expect(page.getByRole('button', { name: 'Create RO' })).toBeDisabled();

    // Page stays on new-ro
    await expect(page).toHaveURL(/\/sales\/new-ro/);
  });

  test('template search filters results', async ({ page }) => {
    await page.goto('/sales/new-ro');

    // Search for tipper — should return at least one result
    await page.locator('.search-input').fill('tipper');
    await expect(page.locator('.template-card').first()).toBeVisible();
    const tipperText = await page.locator('.template-card').first().textContent();
    expect(tipperText?.toLowerCase()).toMatch(/tipper|tp42n/i);

    // Search for something that doesn't exist
    await page.locator('.search-input').fill('xxxxxxnotexist');
    await expect(page.locator('.empty-text')).toBeVisible();
  });

  test('can navigate back to RO list from detail page', async ({ page }) => {
    await page.goto('/sales/new-ro');

    // Wait for dropdowns to load
    await expect(page.locator('select').first().locator('option').nth(1)).not.toBeEmpty();

    await page.locator('select').first().selectOption({ index: 1 });
    await page.locator('select').nth(1).selectOption({ index: 1 });
    await page.locator('input[placeholder="e.g. ABC123"]').fill('BACK01');
    await setFutureDate(page, 30);

    // Pick first template
    await expect(page.locator('.template-card').first()).toBeVisible();
    await page.locator('.template-card').first().click();

    await page.getByRole('button', { name: 'Create RO' }).click();
    await expect(page).toHaveURL(/\/sales\/ro\//, { timeout: 10_000 });

    await page.locator('.back-link').click();
    await expect(page).toHaveURL(/\/sales\/ros/);
  });
});
