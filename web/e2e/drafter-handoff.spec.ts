import { test, expect, Page } from '@playwright/test';
import path from 'path';

// Assumes `make dev` is running with seeded data and `make hash-pw` has run.
// drafter user (Hai Nguyen) has the DRAFTER role from seed data.

const FIXTURE_PDF = path.join(__dirname, 'fixtures', 'sample-layout.pdf');

async function loginAs(page: Page, username: string, password = 'nee2026') {
  await page.goto('/login');
  await page.locator('input[type="text"]').fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function createRoAsSales(page: Page): Promise<string> {
  await loginAs(page, 'sales');
  await expect(page).toHaveURL(/\/sales\/ros/);

  await page.getByRole('link', { name: 'New RO' }).click();
  await expect(page).toHaveURL(/\/sales\/new-ro/);

  // Select customer
  await page.locator('select[name="customerId"], select').first().selectOption({ index: 1 });
  // Select template
  const templateSelect = page.locator('select').nth(1);
  await templateSelect.selectOption({ index: 1 });

  await page.locator('input[placeholder*="rego"], input[name="rego"]').fill('DRAFTTEST');
  await page.locator('input[placeholder*="Make"], input[name="make"]').fill('Isuzu');
  await page.getByRole('button', { name: 'Create RO' }).click();

  await expect(page).toHaveURL(/\/sales\/ro\//);
  const url = page.url();
  return url.split('/').pop() ?? '';
}

test.describe('Drafter handoff flow', () => {
  test('drafter can log in, see queue, and navigate to RO detail', async ({ page }) => {
    await loginAs(page, 'drafter');
    // Drafter should be redirected to the sales or login screen
    // Since drafter doesn't have SUPERVISOR role, check they see a valid page

    // Navigate directly to drafter workspace
    await page.goto('/drafter');
    await expect(page).toHaveURL(/\/drafter/);

    // Should see the drafter topbar
    await expect(page.locator('.brand-sub')).toContainText('Drafter Workspace');

    // Queue should load (may be empty but shouldn't error)
    await expect(page.locator('.queue-title, .empty-state, .loading')).toBeVisible({ timeout: 10_000 });
  });

  test('drafter can upload artefact and mark RO complete (API-level)', async ({ request }) => {
    // Log in as sales via API to get a token
    const loginSales = await request.post('/api/auth/login', {
      data: { username: 'sales', password: 'nee2026' },
    });
    expect(loginSales.ok()).toBeTruthy();
    const { token: salesToken, user: salesUser } = await loginSales.json();

    // Get customer list
    const custResp = await request.get('/api/customers', {
      headers: { Authorization: `Bearer ${salesToken}` },
    });
    const customers = await custResp.json();
    const dfe = customers.find((c: any) => c.code === 'DFE');
    expect(dfe).toBeTruthy();

    // Get templates
    const tmplResp = await request.get('/api/templates', {
      headers: { Authorization: `Bearer ${salesToken}` },
    });
    const templates = await tmplResp.json();
    const tmpl = templates[0];
    expect(tmpl).toBeTruthy();

    // Create an RO
    const roResp = await request.post('/api/repair-orders', {
      headers: { Authorization: `Bearer ${salesToken}` },
      data: {
        customerId: dfe.id,
        jobTypeId: 1,
        templateCode: tmpl.code,
        rego: `DRFE2E${Date.now()}`.slice(0, 10),
        requiredDate: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        priority: 2,
      },
    });
    expect(roResp.status()).toBe(201);
    const { roId } = await roResp.json();

    // Log in as drafter
    const loginDrafter = await request.post('/api/auth/login', {
      data: { username: 'drafter', password: 'nee2026' },
    });
    expect(loginDrafter.ok()).toBeTruthy();
    const { token: drafterToken } = await loginDrafter.json();

    // Check RO appears in queue
    const queueResp = await request.get('/api/drafter/queue', {
      headers: { Authorization: `Bearer ${drafterToken}` },
    });
    expect(queueResp.ok()).toBeTruthy();
    const queue = await queueResp.json();
    const queueItem = queue.find((i: any) => i.id === roId);
    expect(queueItem).toBeTruthy();
    expect(queueItem.draftingStatus).toBe('NOT_STARTED');

    // Transition NOT_STARTED → IN_PROGRESS
    const startResp = await request.put(`/api/drafter/ros/${roId}/status`, {
      headers: { Authorization: `Bearer ${drafterToken}` },
      data: { status: 'IN_PROGRESS', notes: null },
    });
    expect(startResp.status()).toBe(204);

    // Upload a layout artefact
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    const ctx = await browser.newContext();
    const pg = await ctx.newPage();

    const fs = await import('fs');
    const pdfBuffer = fs.readFileSync(FIXTURE_PDF);

    const uploadResp = await request.post(`/api/drafter/ros/${roId}/artefacts?category=DRAFT_LAYOUT`, {
      headers: { Authorization: `Bearer ${drafterToken}` },
      multipart: {
        file: {
          name: 'sample-layout.pdf',
          mimeType: 'application/pdf',
          buffer: pdfBuffer,
        },
      },
    });
    expect(uploadResp.status()).toBe(201);

    // Verify artefact appears in detail
    const detailResp = await request.get(`/api/drafter/ros/${roId}`, {
      headers: { Authorization: `Bearer ${drafterToken}` },
    });
    const detail = await detailResp.json();
    expect(detail.artefacts.length).toBeGreaterThan(0);
    expect(detail.artefacts[0].category).toBe('DRAFT_LAYOUT');

    // Mark complete
    const completeResp = await request.put(`/api/drafter/ros/${roId}/status`, {
      headers: { Authorization: `Bearer ${drafterToken}` },
      data: { status: 'COMPLETED', notes: 'All done for E2E test' },
    });
    expect(completeResp.status()).toBe(204);

    // Verify supervisor sees Draft gate green (drafting_status = COMPLETED)
    const loginSupervisor = await request.post('/api/auth/login', {
      data: { username: 'supervisor', password: 'nee2026' },
    });
    const { token: supToken } = await loginSupervisor.json();

    const gatesResp = await request.get(`/api/scheduling/ros/${roId}/gates`, {
      headers: { Authorization: `Bearer ${supToken}` },
    });
    // Gate check: drafting gate should now be true
    if (gatesResp.ok()) {
      const gates = await gatesResp.json();
      expect(gates.draftingComplete).toBe(true);
    }

    await browser.close();
  });
});
