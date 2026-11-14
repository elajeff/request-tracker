import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { api, loginApi, loginUi } from './auth.js';

const titles = page => page.getByRole('region', { name: 'Request queue' }).getByRole('heading', { level: 3 });
const directory = page => page.getByRole('form', { name: /^Staff / });

test('status finds older matches before pagination and combines with search', async ({ page, request }) => {
  await loginApi(request);
  const token = `queue-filter-${randomUUID().slice(0, 8)}`;
  const older = [];
  for (let i = 0; i < 3; i++) {
    const row = await api(request, 'POST', '/api/requests', { title: `${token} older ${i}`, description: 'Complete queue filtering' });
    await api(request, 'PATCH', `/api/requests/${row.id}/status`, { status: 'IN_PROGRESS' });
    older.push(row);
  }
  for (let i = 0; i < 28; i++) await api(request, 'POST', '/api/requests', { title: `${token} newer ${i}`, description: 'New decoy' });
  await loginUi(page);
  await page.getByRole('searchbox', { name: 'Search requests' }).fill(token);
  await expect(titles(page)).toHaveCount(25);
  const filtered = page.waitForResponse(r => {
    const u = new URL(r.url());
    return u.pathname === '/api/requests' && u.searchParams.get('status') === 'IN_PROGRESS'
      && u.searchParams.get('q') === token && !u.searchParams.has('cursor');
  });
  await page.getByRole('combobox', { name: 'Filter by status', exact: true }).selectOption('IN_PROGRESS');
  expect((await filtered).status()).toBe(200);
  await expect(titles(page)).toHaveText(older.map(r => r.title).reverse());
  await page.getByRole('combobox', { name: 'Filter by status', exact: true }).selectOption('');
  await expect(titles(page)).toHaveCount(25);
});

test("a request created under a status filter it can't match stays out of the list", async ({ page }) => {
  const token = `filter-create-${randomUUID().slice(0, 8)}`;
  await loginUi(page);
  await page.getByRole('searchbox', { name: 'Search requests' }).fill(token);
  const filtered = page.waitForResponse(r => {
    const u = new URL(r.url());
    return u.pathname === '/api/requests' && u.searchParams.get('status') === 'RESOLVED' && u.searchParams.get('q') === token;
  });
  await page.getByRole('combobox', { name: 'Filter by status', exact: true }).selectOption('RESOLVED');
  await filtered;
  await expect(page.getByText('0 matching requests loaded')).toBeVisible();
  const form = page.getByRole('complementary', { name: 'Create request' });
  await form.getByRole('textbox', { name: /^Title/ }).fill(token);
  await form.getByRole('textbox', { name: /^Description/ }).fill('Stays new');
  await form.getByRole('button', { name: 'Create request', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Request created');
  await expect(page.getByText('0 matching requests loaded')).toBeVisible();
  await expect(page.getByRole('article', { name: token })).toHaveCount(0);
});

test('a save while more requests load keeps the pages already loaded', async ({ page, request }) => {
  await loginApi(request);
  const token = `load-more-save-${randomUUID().slice(0, 8)}`;
  for (let i = 0; i < 28; i++) await api(request, 'POST', '/api/requests', { title: `${token} ${i}`, description: 'Paging' });
  await loginUi(page);
  await page.getByRole('searchbox', { name: 'Search requests' }).fill(token);
  await expect(titles(page)).toHaveCount(25);
  let release;
  const held = new Promise(resolve => {
    release = resolve;
  });
  await page.route('**/api/requests?*', async route => {
    if (new URL(route.request().url()).searchParams.has('cursor')) await held;
    await route.continue();
  });
  try {
    const dispatched = page.waitForRequest(r => new URL(r.url()).searchParams.has('cursor'));
    await page.getByRole('button', { name: 'Load more requests' }).click();
    await dispatched;
    const title = `${token} 27`;
    await page.getByRole('combobox', { name: `Status for ${title}` }).selectOption('IN_PROGRESS');
    await page.getByRole('button', { name: `Save status for ${title}` }).click();
    await expect(page.locator('#notice')).toContainText('Status updated');
    release();
    await expect(titles(page)).toHaveCount(28);
    await expect(page.getByRole('combobox', { name: `Status for ${title}` })).toHaveValue('IN_PROGRESS');
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('staff backend search stays paginated, resets when cleared and rejects slower old responses', async ({ page, request }) => {
  await loginApi(request);
  const token = `directory-filter-${randomUUID().slice(0, 8)}`;
  const people = [];
  for (let i = 0; i < 35; i++) people.push(await api(request, 'POST', '/api/staff', { name: `${token} ${String(i).padStart(2, '0')}` }));
  people.sort((a, b) => a.id.localeCompare(b.id));
  const target = people.at(-1);
  await loginUi(page);
  await page.getByText('Manage support staff', { exact: true }).click();
  await expect(directory(page)).toHaveCount(25);
  await expect(page.getByRole('form', { name: `Staff ${target.name}`, exact: true })).toHaveCount(0);
  const searches = [];
  page.on('request', r => {
    const u = new URL(r.url());
    if (u.pathname === '/api/staff') searches.push(u);
  });
  await page.getByRole('searchbox', { name: 'Search staff' }).fill(token);
  await expect(directory(page)).toHaveCount(25);
  await expect(page.getByRole('button', { name: 'Load more staff' })).toBeVisible();
  expect(searches.filter(u => u.searchParams.get('q') === token && u.searchParams.has('cursor'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Load more staff' }).click();
  await expect(directory(page)).toHaveCount(35);
  await page.getByRole('searchbox', { name: 'Search staff' }).fill('');
  await expect(directory(page)).toHaveCount(25);
  let release, finish;
  const held = new Promise(resolve => {
    release = resolve;
  });
  const finished = new Promise(resolve => {
    finish = resolve;
  });
  await page.route('**/api/staff?*', async route => {
    if (new URL(route.request().url()).searchParams.get('q') === token) {
      const response = await route.fetch();
      await held;
      await route.fulfill({ response }).catch(() => {});
      finish();
    } else await route.continue();
  });
  const pending = page.waitForRequest(r => new URL(r.url()).pathname === '/api/staff' && new URL(r.url()).searchParams.get('q') === token);
  await page.getByRole('searchbox', { name: 'Search staff' }).fill(token);
  await pending;
  await page.getByRole('searchbox', { name: 'Search staff' }).fill(target.name);
  await expect(directory(page)).toHaveCount(1);
  await expect(page.getByRole('form', { name: `Staff ${target.name}`, exact: true })).toBeVisible();
  release();
  await finished;
  await expect(directory(page)).toHaveCount(1);
  expect(searches.some(u => u.searchParams.get('q') === target.name)).toBe(true);
});
