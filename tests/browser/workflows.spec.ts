import { test, expect, type Page } from '@playwright/test';
const credentials = { email: 'admin@test.local', password: process.env.UTB_E2E_PASSWORD! };
async function login(page: Page, role = 'admin') {
  await page.goto('/');
  await page.getByLabel('Email address').fill(role + '@test.local');
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'A clear view of your stock.' })).toBeVisible();
}
async function field(page: Page, name: string, value: string) {
  await page.getByRole('dialog').getByLabel(name, { exact: true }).fill(value);
}
async function select(page: Page, name: string, label: string) {
  await page.getByRole('dialog').getByLabel(name, { exact: true }).selectOption({ label });
}
async function save(page: Page, name: string) {
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
test('login reports gateway outages clearly and can retry after recovery', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email address').fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  const gatewayFailure = (route: import('@playwright/test').Route) =>
    route.fulfill({
      status: 502,
      contentType: 'text/plain',
      body: 'An error occurred with this application. DNS_HOSTNAME_NOT_FOUND',
    });
  await page.route('**/api/auth/login', gatewayFailure);
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'The inventory server is unavailable. Please try again shortly.',
  );
  await expect(page.getByText('Unexpected token', { exact: false })).toHaveCount(0);
  await page.unroute('**/api/auth/login', gatewayFailure);
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'A clear view of your stock.' })).toBeVisible();
});
test('main pages, catalog import, stock setup, recipe sale, waste/count, void and persistence', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await login(page);
  for (const [link, heading] of [
    ['Inventory', 'Inventory'],
    ['Menu & recipes', 'Menu & recipes'],
    ['Suppliers', 'Suppliers'],
    ['Purchasing & receiving', 'Purchasing & receiving'],
    ['Stock movements', 'Stock movements'],
    ['Wastage & counts', 'Wastage & stock counts'],
    ['Operational sales', 'Operational sales'],
    ['CSV imports', 'CSV imports'],
    ['Reports', 'Inventory reports'],
    ['Users & settings', 'Users & settings'],
  ]) {
    await page.getByRole('navigation').getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await page.getByRole('link', { name: 'CSV imports', exact: true }).click();
  await page.getByLabel('CSV file').setInputFiles({
    name: 'browser-catalog.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'TransactionID,ProductName,Category,Qty,UnitPrice,SalesAmount\n1,TEST ONLY Freebie,Promo,99,999,98901\n2,TEST ONLY Freebie,Promo,2,999,1998\n',
    ),
  });
  await page.getByRole('button', { name: 'Upload & preview' }).click();
  await expect(page.getByRole('button', { name: 'Confirm import', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Confirm import', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Already confirmed' })).toBeDisabled();
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await field(page, 'SKU', 'TEST-CUP');
  await field(page, 'Item name', 'TEST ONLY Cup');
  await field(page, 'Category', 'Packaging');
  await select(page, 'Base unit', 'piece');
  await field(page, 'Storage location', 'TEST shelf');
  await field(page, 'Reorder point (base units)', '2');
  await field(page, 'Target stock (base units)', '20');
  await save(page, 'Save record');
  await expect(page.getByText('Opening stock not configured', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set opening stock', exact: true }).click();
  await field(page, 'Reference', 'TEST-OPEN');
  await field(page, 'Reason', 'TEST ONLY physical stock');
  await field(page, 'Counted opening quantity', '20');
  await field(page, 'Batch label', 'TEST initial');
  await save(page, 'Post opening balance');
  await expect(page.getByRole('table').getByText('Healthy', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Menu & recipes', exact: true }).click();
  await page.getByRole('button', { name: 'Edit TEST ONLY Freebie', exact: true }).click();
  await field(page, 'Confirmed current selling price (₱)', '0');
  await save(page, 'Save record');
  await page.getByRole('button', { name: 'Map recipe', exact: true }).click();
  await select(page, 'Inventory item', 'TEST ONLY Cup · TEST-CUP');
  await field(page, 'Quantity per serving', '2');
  await select(page, 'Unit', 'piece');
  await field(page, 'Reason for this version', 'TEST ONLY confirmed recipe');
  await save(page, 'Publish recipe version');
  await page.getByRole('link', { name: 'Operational sales', exact: true }).click();
  await page.getByRole('button', { name: 'Record sale', exact: true }).click();
  await field(page, 'Reference', 'TEST-SALE');
  await field(page, 'Reason', 'TEST ONLY genuine dated sale fixture');
  await page
    .getByRole('dialog')
    .getByLabel('Menu product', { exact: true })
    .selectOption({ index: 1 });
  await field(page, 'Units sold', '3');
  await field(page, 'Confirmed actual unit price (₱)', '0');
  await field(page, 'Recorded line amount (₱)', '0');
  await page.getByRole('button', { name: 'Preview consumption' }).click();
  await expect(page.getByText('6 piece', { exact: true })).toBeVisible();
  await save(page, 'Confirm & post sale');
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await expect(page.getByText('14 piece', { exact: true })).toHaveCount(2);
  await page.reload();
  await expect(page.getByText('14 piece', { exact: true })).toHaveCount(2);
  await page.getByRole('link', { name: 'Wastage & counts', exact: true }).click();
  await page.getByRole('button', { name: 'Record wastage', exact: true }).click();
  await field(page, 'Reference', 'TEST-WASTE');
  await field(page, 'Reason', 'TEST ONLY damage');
  await select(page, 'Configured inventory item', 'TEST ONLY Cup · TEST-CUP');
  await field(page, 'Wasted quantity', '2');
  await field(page, 'Waste category', 'Damage');
  await save(page, 'Post wastage');
  await page.getByRole('button', { name: 'Physical count', exact: true }).click();
  await field(page, 'Reference', 'TEST-COUNT');
  await field(page, 'Reason', 'TEST ONLY recount');
  await select(page, 'Configured inventory item', 'TEST ONLY Cup · TEST-CUP');
  await page
    .getByRole('dialog')
    .getByLabel('Counted batch', { exact: true })
    .selectOption({ index: 1 });
  await field(page, 'Physical counted balance', '10');
  await page.getByRole('button', { name: 'Preview difference' }).click();
  await expect(page.getByText('-2 piece', { exact: true })).toBeVisible();
  await save(page, 'Post count adjustment');
  await page.getByRole('link', { name: 'Operational sales', exact: true }).click();
  await page.getByRole('button', { name: 'Void sale', exact: true }).click();
  await field(page, 'Reference', 'TEST-VOID');
  await field(page, 'Reason', 'TEST ONLY correction');
  await save(page, 'Post linked reversal');
  await expect(page.getByText('Voided', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await expect(page.getByText('16 piece', { exact: true })).toHaveCount(2);
  await page.screenshot({ path: 'test-results/inventory-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A clear view of your stock.' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await expect
    .poll(() => page.locator('aside').evaluate((el) => el.getBoundingClientRect().right))
    .toBeLessThanOrEqual(0);
  await page.screenshot({
    path: 'test-results/overview-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  assertNoErrors(errors);
});
function assertNoErrors(errors: string[]) {
  expect(errors).toEqual([]);
}
test('supplier, draft order, partial receiving and remaining quantities work through forms', async ({
  page,
}) => {
  page.on('dialog', (d) => d.accept());
  await login(page);
  const me = await (await page.request.get('/api/auth/me')).json();
  const headers = { 'X-CSRF-Token': me.csrf };
  const inventory = await page.request.post('/api/inventory', {
    headers,
    data: {
      sku: 'TEST-RECEIVING',
      name: 'TEST ONLY Receiving',
      category: 'Test',
      base_unit: 'piece',
      location: 'TEST shelf',
      reorder_point: 1,
      target: 40,
      expiry_tracking: false,
    },
  });
  expect(inventory.status()).toBe(201);
  const iid = (await inventory.json()).id;
  const opening = await page.request.post(`/api/inventory/${iid}/opening`, {
    headers,
    data: {
      key: 'TEST-RECEIVING-OPEN',
      reference: 'TEST-RECEIVING-OPEN',
      reason: 'TEST fixture',
      occurred_at: new Date().toISOString(),
      quantity: 16,
      unit: 'piece',
      batch_label: 'TEST opening',
    },
  });
  expect(opening.ok()).toBe(true);
  await page.getByRole('link', { name: 'Suppliers', exact: true }).click();
  await page.getByRole('button', { name: 'Add supplier' }).click();
  await field(page, 'Supplier name', 'TEST ONLY Supplier');
  await field(page, 'Contact / phone', 'TEST contact');
  await save(page, 'Save record');
  await page.getByRole('link', { name: 'Purchasing & receiving', exact: true }).click();
  await page.getByRole('button', { name: 'New purchase order' }).click();
  await field(page, 'PO reference', 'TEST-PO');
  await select(page, 'Supplier', 'TEST ONLY Supplier');
  await field(page, 'Expected date', '2026-11-16');
  await select(page, 'Inventory item', 'TEST ONLY Receiving · TEST-RECEIVING');
  await field(page, 'Ordered quantity', '10');
  await select(page, 'Ordering unit', 'piece');
  await field(page, 'Purchase cost per ordering unit (₱)', '5');
  await save(page, 'Save draft order');
  await page.getByRole('button', { name: 'View / receive' }).click();
  await page.getByRole('button', { name: 'Submit order' }).click();
  await expect(page.getByRole('button', { name: 'Record delivery' })).toBeVisible();
  await page.getByRole('button', { name: 'Record delivery' }).click();
  await field(page, 'Reference', 'TEST-RECEIPT');
  await field(page, 'Reason', 'TEST ONLY delivered goods');
  await field(page, 'Unique delivery reference', 'TEST-DELIVERY');
  await page
    .getByRole('dialog')
    .getByLabel('Order line', { exact: true })
    .selectOption({ index: 1 });
  await field(page, 'Received quantity', '4');
  await select(page, 'Unit', 'piece');
  await field(page, 'Batch label', 'TEST delivered');
  await save(page, 'Post receipt');
  await expect(page.getByRole('table').getByText('partial', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'View / receive' }).click();
  await expect(page.getByRole('cell', { name: '6', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await expect(page.getByText('20 piece', { exact: true })).toHaveCount(2);
});
test('staff navigation and server restrictions; logout requires a new login', async ({ page }) => {
  await login(page, 'staff');
  await expect(page.getByRole('link', { name: 'Users & settings' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Operational sales', exact: true })).toHaveCount(0);
  const response = await page.request.get('/api/users');
  expect(response.status()).toBe(403);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  expect((await page.request.get('/api/inventory')).status()).toBe(401);
});

test('CSV report download and complete printable report render', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inventory reports', exact: true })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Export CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('stock.csv');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toContain('"sku","name"');
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: 'Print full report' }).click(),
  ]);
  await expect(
    popup.getByRole('heading', { name: 'Under the Balete Inventory', exact: true }),
  ).toBeVisible();
  await expect(popup.getByRole('table')).toBeVisible();
  await popup.close();
});
