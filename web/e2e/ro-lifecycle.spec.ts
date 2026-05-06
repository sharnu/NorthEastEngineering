import { test, expect, Page } from '@playwright/test';

// Requires: make dev + make reset && make hash-pw

async function loginAs(page: Page, username: string) {
  await page.goto('/login');
  await page.locator('input[type="text"]').fill(username);
  await page.locator('input[type="password"]').fill('nee2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function setFutureDate(page: Page, daysAhead: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  await page.locator('input[type="date"]').fill(d.toISOString().split('T')[0]);
}

test.describe('E14 RO lifecycle', () => {
  let roUrl: string;

  // ── Step 1: Create RO ──────────────────────────────────────────────────────
  test('1 — sales creates RO from template', async ({ page }) => {
    await loginAs(page, 'sales');

    await page.getByRole('button', { name: '+ New RO' }).click();
    await expect(page).toHaveURL(/\/sales\/new-ro/);

    await expect(page.locator('select').first().locator('option').nth(1)).not.toBeEmpty();
    await page.locator('select').first().selectOption({ label: 'Direct Freight Express' });
    await page.locator('select').nth(1).selectOption({ label: 'New build' });
    await page.locator('input[placeholder="e.g. ABC123"]').fill('E14TEST');
    await page.locator('input[placeholder="e.g. Isuzu"]').fill('Isuzu');
    await page.locator('input[placeholder="e.g. NPR75"]').fill('NPR');
    await setFutureDate(page, 90);

    await page.locator('.search-input').fill('tipper');
    await expect(page.locator('.template-card').first()).toBeVisible();
    await page.locator('.template-card', { hasText: 'TP42N' }).click();

    await page.waitForResponse(r => r.url().includes('/api/repair-orders') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create RO' }).click();

    await expect(page).toHaveURL(/\/sales\/ro\/[0-9a-f-]+/, { timeout: 10_000 });
    roUrl = page.url();

    await expect(page.locator('.task-row').first()).toBeVisible();
    await expect(page.locator('.scene-title')).toContainText('Direct Freight Express');
  });

  // ── Step 2: Edit rego ──────────────────────────────────────────────────────
  test('2 — sales edits rego (E14-S1)', async ({ page }) => {
    await loginAs(page, 'sales');
    await page.goto(roUrl ?? '/sales/ros');
    if (!roUrl) { test.skip(); return; }

    await page.locator('.btn-edit').click();
    const regoInput = page.locator('input[placeholder*="rego"], input[placeholder*="Rego"], .edit-form input').first();
    await regoInput.clear();
    await regoInput.fill('E14-EDITED');

    await page.waitForResponse(r => r.url().includes('/api/repair-orders') && r.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('.scene-title, .rego-value, .field-value')).toContainText(/E14-EDITED/i, { timeout: 6_000 });
  });

  // ── Step 3: Add a task ─────────────────────────────────────────────────────
  test('3 — sales adds a task (E14-S2)', async ({ page }) => {
    await loginAs(page, 'sales');
    await page.goto(roUrl ?? '/sales/ros');
    if (!roUrl) { test.skip(); return; }

    const initialCount = await page.locator('.task-row').count();

    await page.locator('.btn-add-task').click();
    await expect(page.locator('.modal-title', { hasText: 'Add Task' })).toBeVisible();

    await expect(page.locator('select').first().locator('option').nth(1)).not.toBeEmpty();
    await page.locator('select').first().selectOption({ index: 1 });

    await page.waitForResponse(r => r.url().includes('/api/repair-orders') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Add Task' }).click();

    await expect(page.locator('.task-row')).toHaveCount(initialCount + 1, { timeout: 6_000 });
  });

  // ── Step 4: Reorder tasks ──────────────────────────────────────────────────
  test('4 — sales reorders tasks (E14-S2)', async ({ page }) => {
    await loginAs(page, 'sales');
    await page.goto(roUrl ?? '/sales/ros');
    if (!roUrl) { test.skip(); return; }

    const firstBefore = await page.locator('.task-row').first().textContent();

    // Move first task down
    const downBtn = page.locator('.reorder-btn[title="Move down"]').first();
    if (await downBtn.isVisible()) {
      await page.waitForResponse(r => r.url().includes('/tasks/reorder') && r.request().method() === 'PUT');
      await downBtn.click();
      const firstAfter = await page.locator('.task-row').first().textContent();
      expect(firstAfter).not.toBe(firstBefore);
    }
  });

  // ── Step 5: Supervisor overrides kanban stage via RO detail ────────────────
  test('5 — supervisor overrides kanban stage (E14-S4)', async ({ page }) => {
    await loginAs(page, 'supervisor');
    await page.goto(roUrl ?? '/sales/ros');
    if (!roUrl) { test.skip(); return; }

    await page.locator('.btn-override').click();
    await expect(page.locator('.modal-title', { hasText: 'Override' })).toBeVisible();

    await expect(page.locator('select').first().locator('option').nth(1)).not.toBeEmpty();
    await page.locator('.modal select').selectOption({ label: 'Final QC' });
    await page.locator('.modal textarea').fill('E14 lifecycle test — override to Final QC stage');

    await page.waitForResponse(r => r.url().includes('/override-stage') && r.request().method() === 'POST');
    await page.locator('.btn-primary', { hasText: 'Override Stage' }).click();

    // Modal closes
    await expect(page.locator('.modal-title', { hasText: 'Override' })).not.toBeVisible({ timeout: 5_000 });
  });

  // ── Step 6: Supervisor cancels RO ─────────────────────────────────────────
  test('6 — supervisor cancels RO (E14-S3)', async ({ page }) => {
    await loginAs(page, 'supervisor');
    await page.goto(roUrl ?? '/sales/ros');
    if (!roUrl) { test.skip(); return; }

    await page.locator('.btn-cancel-ro').click();
    await expect(page.locator('.modal-title', { hasText: 'Cancel' })).toBeVisible();

    await page.locator('.modal textarea').fill('E14 lifecycle test — cancellation reason here');

    await page.waitForResponse(r => r.url().includes('/cancel') && r.request().method() === 'POST');
    await page.locator('.btn-danger', { hasText: 'Yes, cancel RO' }).click();

    await expect(page.locator('.cancel-banner')).toBeVisible({ timeout: 6_000 });
    await expect(page.locator('.cancel-banner')).toContainText('This RO was cancelled');
  });

  // ── Step 7: Admin reopens RO ───────────────────────────────────────────────
  test('7 — admin reopens RO (E14-S3)', async ({ page }) => {
    await loginAs(page, 'supervisor'); // supervisor is also ADMIN in seed (role ADMIN token)
    await page.goto(roUrl ?? '/sales/ros');
    if (!roUrl) { test.skip(); return; }

    await expect(page.locator('.cancel-banner')).toBeVisible();
    await page.locator('.btn-reopen').click();

    await page.waitForResponse(r => r.url().includes('/reopen') && r.request().method() === 'POST');
    await expect(page.locator('.cancel-banner')).not.toBeVisible({ timeout: 6_000 });
  });
});
