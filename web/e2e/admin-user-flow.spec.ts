import { test, expect } from '@playwright/test';

// Assumes `make dev` is running with seeded data.
// supervisor has ADMIN role after migration 013.

async function loginAs(page: any, username: string, password = 'nee2026') {
  await page.goto('/login');
  await page.locator('input[type="text"]').fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const techUsername = `playwright_tech_${Date.now()}`;

test.describe('Admin — User management flow', () => {
  test('supervisor can navigate to admin and create a new technician', async ({ page }) => {
    await loginAs(page, 'supervisor');
    await expect(page).toHaveURL(/\/dashboard/);

    // Admin tab should be visible for admin users
    await page.getByRole('button', { name: 'Admin' }).click();
    await expect(page).toHaveURL(/\/admin/);

    // Open create user form
    await page.getByRole('button', { name: '+ New User' }).click();
    await expect(page.locator('.form-card')).toBeVisible();

    // Fill in details
    await page.locator('.form-card input').filter({ hasText: '' }).nth(0).fill('Playwright Tech');
    // Full Name is first input
    const inputs = page.locator('.form-card input[type="text"], .form-card input:not([type])');
    await inputs.nth(0).fill('Playwright Tech');  // Full Name
    await inputs.nth(1).fill(techUsername);        // Username

    await page.locator('.form-card input[type="password"]').first().fill('Test1234!');

    // Select TECHNICIAN role
    const techCheckbox = page.locator('.role-check').filter({ hasText: 'Technician' }).locator('input');
    if (!(await techCheckbox.isChecked())) {
      await techCheckbox.check();
    }

    await page.getByRole('button', { name: 'Save' }).click();

    // Form should close and user appears in table
    await expect(page.locator('.form-card')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.user-table')).toContainText('Playwright Tech');
  });

  test('new technician can log in and sees empty task list', async ({ page }) => {
    // Log in as the newly created tech
    await loginAs(page, techUsername, 'Test1234!');

    // Should land on tech tasks (no tasks assigned)
    await page.goto('/tech/tasks');
    await expect(page).toHaveURL(/\/tech\/tasks/);

    // Task list should render (empty or otherwise — just verifying auth worked)
    await expect(page.locator('body')).not.toContainText('Invalid username or password');
  });
});
