import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { csrfHeaders, loginApi, loginUi } from './auth.js';

async function api(request, method, path, data) {
  const response = await request.fetch(path, { method, data,
    headers: method === 'GET' ? {} : await csrfHeaders(request) });
  expect(response.status()).toBe(method === 'POST' ? 201 : 200);
  return response.json();
}
async function mutate(page, method, path, action) {
  const [response] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === method), action(),
  ]);
  expect(response.status()).toBe(method === 'POST' ? 201 : 200);
  return response.json();
}
const directory = page => page.getByRole('form', { name: /^Staff / });
const staffRow = (page, person) => page.getByRole('form', { name: `Staff ${person.name} ${person.id}`, exact: true });
async function open(page) {
  await page.getByText('Manage support staff', { exact: true }).click();
  await expect(page.getByText(/^\d+ staff shown/)).toBeVisible();
}

test('React staff lifecycle keeps assignments, history and reloads consistent', async ({ page, request }) => {
  const prefix = `staff-life-${randomUUID().slice(0, 8)}`;
  await loginApi(request);
  const assigned = await api(request, 'POST', '/api/requests', { title: prefix, description: 'Staff lifecycle' });
  const waiting = await api(request, 'POST', '/api/requests', { title: `${prefix} waiting`, description: 'Pending assignment' });
  await loginUi(page);
  await page.getByRole('searchbox', { name: 'Search requests' }).fill(prefix);
  const card = page.getByRole('article', { name: prefix, exact: true });
  await expect(card).toBeVisible();
  await open(page);
  await page.getByRole('textbox', { name: 'Staff name', exact: true }).fill(prefix);
  const person = await mutate(page, 'POST', '/api/staff', () => page.getByRole('button', { name: 'Create staff', exact: true }).click());
  const select = card.getByRole('combobox', { name: `Assigned staff for ${prefix}` });
  await select.selectOption(person.id);
  await mutate(page, 'PATCH', `/api/requests/${assigned.id}/assignment`, () => card.getByRole('button', { name: 'Save assignment' }).click());
  const renamed = `${prefix} renamed`;
  let row = staffRow(page, person);
  await row.getByRole('textbox').fill(renamed);
  await mutate(page, 'PUT', `/api/staff/${person.id}`, () => row.getByRole('button', { name: 'Save name' }).click());
  person.name = renamed;
  row = staffRow(page, person);
  await expect(card).toContainText(`Assigned staff: ${renamed}`);
  const pending = page.getByRole('article', { name: waiting.title, exact: true })
    .getByRole('combobox', { name: `Assigned staff for ${waiting.title}` });
  await pending.selectOption(person.id);
  await mutate(page, 'PATCH', `/api/staff/${person.id}/active`, () => row.getByRole('button', { name: 'Deactivate', exact: true }).click());
  await expect(row).toContainText('Inactive');
  await expect(select).toHaveValue(person.id);
  await expect(select.locator('option', { hasText: person.id })).toHaveJSProperty('disabled', true);
  await expect(pending).toHaveValue('');
  await expect(pending.locator('option', { hasText: person.id })).toHaveCount(0);
  expect(await api(request, 'GET', `/api/requests/${assigned.id}`)).toMatchObject({ assigneeId: person.id, assigneeActive: false });
  const history = await api(request, 'GET', `/api/requests/${assigned.id}/history`);
  expect(history.items.find(item => item.field === 'ASSIGNEE').newValue).toContain(prefix);
  expect(history.items.find(item => item.field === 'ASSIGNEE').newValue).not.toContain('renamed');
  await mutate(page, 'PATCH', `/api/staff/${person.id}/active`, () => row.getByRole('button', { name: 'Reactivate' }).click());
  await expect(select.locator('option', { hasText: person.id })).toHaveJSProperty('disabled', false);
  await page.reload();
  await open(page);
  await page.getByRole('searchbox', { name: 'Search staff' }).fill(renamed);
  await expect(staffRow(page, person)).toContainText('Active');
  await page.locator('#staff-management-root').screenshot({ path: '/results/react-staff.png' });
  expect(await api(request, 'GET', `/api/requests/${assigned.id}`)).toMatchObject({ assignee: renamed, assigneeActive: true });
});

test('staff cursor loading deduplicates records and search includes later pages', async ({ page, request }) => {
  const prefix = `staff-pages-${randomUUID().slice(0, 8)}`;
  await loginApi(request);
  for (let index = 0; index < 31; index++) await api(request, 'POST', '/api/staff', { name: `${prefix} ${index}` });
  await loginUi(page);
  await open(page);
  const initial = await directory(page).evaluateAll(rows => rows.map(row => row.getAttribute('aria-label')));
  await expect(page.getByRole('button', { name: 'Load more staff' })).toBeVisible();
  await page.getByRole('button', { name: 'Load more staff' }).click();
  await expect(page.getByText(/^\d+ staff shown/)).toBeVisible();
  await expect.poll(() => directory(page).count()).toBeGreaterThan(initial.length);
  const loaded = await directory(page).evaluateAll(rows => rows.map(row => row.getAttribute('aria-label')));
  expect(new Set(loaded).size).toBe(loaded.length);
  for (const label of initial) expect(loaded).toContain(label);
  await page.getByRole('searchbox', { name: 'Search staff' }).fill(prefix);
  await expect(directory(page)).toHaveCount(25);
  await page.getByRole('button', { name: 'Load more staff' }).click();
  await expect(directory(page)).toHaveCount(31);
  await expect(page.getByRole('button', { name: 'Load more staff' })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search staff' }).fill(`${prefix} absent`);
  await expect(page.getByText('No matching staff.', { exact: true })).toBeVisible();
  await expect(directory(page)).toHaveCount(0);
});

test('staff empty, load retry, validation and failed save retain usable drafts', async ({ page, request }) => {
  await loginApi(request);
  await page.route('**/api/staff?*', route => route.fulfill({ status: 503, json: { detail: 'Temporary staff outage' } }));
  await loginUi(page);
  await page.getByText('Manage support staff', { exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Temporary staff outage');
  await page.unroute('**/api/staff?*');
  await page.route('**/api/staff?*', route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.getByRole('button', { name: 'Retry loading staff' }).click();
  await expect(page.getByText('No staff records yet.', { exact: true })).toBeVisible();
  await page.unroute('**/api/staff?*');
  await page.getByRole('button', { name: 'Refresh staff' }).click();
  await expect(page.getByText(/^\d+ staff shown/)).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Staff name', exact: true });
  await input.fill('   ');
  await page.getByRole('button', { name: 'Create staff', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('between 1 and 120');
  const name = `staff-retry-${randomUUID().slice(0, 8)}`;
  await input.fill(name);
  await page.route('**/api/staff', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { detail: 'Save unavailable' } }) : route.continue());
  await page.getByRole('button', { name: 'Create staff', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Save unavailable');
  await expect(input).toHaveValue(name);
  await page.unroute('**/api/staff');
  const person = await mutate(page, 'POST', '/api/staff', () => page.getByRole('button', { name: 'Create staff', exact: true }).click());
  await expect(staffRow(page, person)).toBeVisible();
  await expect(input).toHaveValue('');
});

test('React staff state clears on session loss and stays absent for requesters', async ({ page }) => {
  await loginUi(page);
  await open(page);
  await page.getByRole('textbox', { name: 'Staff name', exact: true }).fill('Unsaved private staff draft');
  expect((await page.request.post('/api/session/logout', { headers: await csrfHeaders(page.request) })).status()).toBe(204);
  await page.getByRole('button', { name: 'Refresh staff' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(directory(page)).toHaveCount(0);
  await loginUi(page, 'REQUESTER');
  await expect(page.getByText('Manage support staff', { exact: true })).toHaveCount(0);
  expect((await page.request.get('/api/staff')).status()).toBe(403);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await loginUi(page);
  await open(page);
  await expect(page.getByRole('textbox', { name: 'Staff name', exact: true })).toHaveValue('');
});
