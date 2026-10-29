import { test, expect } from '@playwright/test';
import { loginApi, loginUi, csrfHeaders } from './auth.js';

test('requester owns persisted details and history while support alone manages the request', async ({ page, request }) => {
  await loginApi(request);
  const foreign = await request.post('/api/requests', {
    headers: await csrfHeaders(request), data: { title: 'e2e-private support request', description: 'Support only' },
  });
  expect(foreign.status()).toBe(201);
  const foreignId = (await foreign.json()).id;
  await loginUi(page, 'REQUESTER');
  await expect(page.getByText('Manage support staff', { exact: true })).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Filter by assigned staff' })).toBeHidden();
  const form = page.getByRole('complementary', { name: 'Create request' });
  await expect(form.getByRole('combobox', { name: 'Priority', exact: true })).toBeHidden();
  await form.getByRole('textbox', { name: /^Title/ }).fill('e2e-private requester');
  await form.getByRole('textbox', { name: /^Description/ }).fill('Requester details');
  const [createdResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/requests' && response.request().method() === 'POST'),
    form.getByRole('button', { name: 'Create request', exact: true }).click(),
  ]);
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  const card = page.getByRole('article', { name: created.title, exact: true });
  await expect(card).toContainText('Requester details');
  await expect(card.getByRole('combobox')).toHaveCount(0);
  await card.getByRole('button', { name: `Edit details for ${created.title}` }).click();
  await card.getByRole('textbox', { name: 'Description', exact: true }).fill('Edited requester details');
  await card.getByRole('button', { name: 'Save changes' }).click();
  await expect(card).toContainText('Edited requester details');
  await page.reload();
  await expect(card).toContainText('Edited requester details');
  for (const suffix of ['', '/history?limit=1']) {
    expect((await page.request.get(`/api/requests/${foreignId}${suffix}`)).status()).toBe(404);
  }
  const queue = await page.request.get('/api/requests?q=e2e-private&limit=1');
  expect(queue.status()).toBe(200);
  expect((await queue.json()).items.map(item => item.id)).toEqual([created.id]);
  const updated = await request.patch(`/api/requests/${created.id}/status`, {
    headers: await csrfHeaders(request), data: { status: 'IN_PROGRESS' },
  });
  expect(updated.status()).toBe(200);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(card.getByRole('button', { name: `Edit details for ${created.title}` })).toHaveCount(0);
  await card.getByText('Change history', { exact: true }).click();
  const history = card.getByRole('list', { name: `Change history for ${created.title}` });
  await expect(history.getByRole('listitem').getByRole('paragraph')).toHaveText([
    'NEW → IN_PROGRESS', 'Requester details → Edited requester details', `Created: ${created.title}`,
  ]);
  await expect(history.getByText(/status · e2e-support/)).toBeVisible();
  await expect(history.getByText(/description · e2e-requester/)).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect((await page.request.get(`/api/requests/${created.id}`)).status()).toBe(401);
  await loginUi(page, 'OTHER');
  await expect(page.getByRole('article', { name: created.title, exact: true })).toHaveCount(0);
  expect((await page.request.get(`/api/requests/${created.id}/history`)).status()).toBe(404);
});

test('invalidated server session clears private content and permits a fresh login', async ({ page }) => {
  await loginUi(page, 'REQUESTER');
  const logout = await page.request.post('/api/session/logout', { headers: await csrfHeaders(page.request) });
  expect(logout.status()).toBe(204);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByText('Your session ended. Sign in again.', { exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await loginUi(page);
  await expect(page.getByText('Manage support staff', { exact: true })).toBeVisible();
});
