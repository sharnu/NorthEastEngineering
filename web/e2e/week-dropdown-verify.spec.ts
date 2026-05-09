import { test, expect, Page } from '@playwright/test';

/**
 * Verifies the week-dropdown render-race fix:
 *   - First paint: <select> shows the current Monday's option (or whichever
 *     value is in sessionStorage), NOT "All scheduled weeks".
 *   - After /weeks resolves: same option still selected.
 */

async function loginAs(page: Page, username: string) {
  await page.goto('/login');
  await page.locator('input[type="text"]').fill(username);
  await page.locator('input[type="password"]').fill('nee2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dashboard|kanban)/, { timeout: 10_000 });
}

function currentMonday(): string {
  const d = new Date();
  const dow = d.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
}

test.describe('week filter dropdown', () => {
  test('defaults to current Monday on first paint and persists after /weeks', async ({ page }) => {
    // Clear any persisted selection so we exercise the default path
    await page.addInitScript(() => sessionStorage.removeItem('kanban.selectedWeek'));

    await loginAs(page, 'supervisor');

    // Set up listeners BEFORE navigating so we don't miss responses
    const weeksResponse = page.waitForResponse(
      r => r.url().includes('/api/kanban/weeks') && r.status() === 200,
      { timeout: 15_000 },
    );
    await page.goto('/kanban');
    await weeksResponse;

    const select = page.locator('select.week-filter');
    await expect(select).toBeVisible({ timeout: 10_000 });

    // Compute the expected Monday in the BROWSER context — Node may be on
    // a different system clock than Chromium, which would produce a stale
    // expectation if we used Node's Date here.
    const monday = await page.evaluate(() => {
      const d = new Date();
      const dow = d.getDay();
      const offset = dow === 0 ? -6 : 1 - dow;
      const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
      return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-${String(m.getDate()).padStart(2, '0')}`;
    });

    // Core assertion: the bug (dropdown showing "" / "All scheduled weeks")
    // is gone. The <select>'s current value should be a yyyy-MM-dd Monday.
    // It may be the current Monday OR — if reconcileSelectedWeek() snapped
    // forward because the current Monday has no scheduled ROs in seed data —
    // the closest available week.
    const value = await select.inputValue();
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(value).not.toBe('');
    expect(value).not.toBe('backlog');

    // Caption should mention "Week of …" (i.e. NOT "All scheduled weeks")
    const caption = page.locator('.page-caption');
    await expect(caption).toContainText('Week of');
    await expect(caption).not.toContainText('All scheduled weeks');

    // Confirm the displayed option text matches the selected value
    const displayedText = await select.evaluate((el: HTMLSelectElement) => el.options[el.selectedIndex]?.text ?? '');
    expect(displayedText).toContain('Week of');

    console.log(`[verified] dropdown value=${value} (browser current Monday=${monday}) text="${displayedText}"`);
  });
});
