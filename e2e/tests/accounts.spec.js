import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { csrfHeaders, loginApi, loginUi, mutate } from './auth.js';

async function open(page) {
  await page.getByText('Manage accounts', { exact: true }).click();
  await expect(page.getByText(/^\d+ accounts shown/)).toBeVisible();
}
async function signIn(page, username, password) {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}
const accountRow = (page, username) => page.getByRole('form', { name: `Account ${username}`, exact: true });

test('support creates an account and changes its status, role and password', async ({ page }) => {
  const username = `acct-${randomUUID().slice(0, 8)}`;
  const password = `first-${randomUUID()}`;
  await loginUi(page);
  await open(page);
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(username);
  await page.getByLabel('Initial password').fill(password);
  const created = await mutate(page, 'POST', '/api/accounts',
    () => page.getByRole('button', { name: 'Create account', exact: true }).click(), 201);
  expect(created).toEqual({ id: expect.any(String), username, role: 'REQUESTER', enabled: true });
  const row = accountRow(page, username);
  await expect(row).toContainText(`${username} · Requester · Active`);
  await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toHaveValue('');

  await mutate(page, 'PATCH', `/api/accounts/${username}/enabled`, () => row.getByRole('button', { name: 'Disable' }).click());
  await expect(row).toContainText('Requester · Disabled');
  await mutate(page, 'PATCH', `/api/accounts/${username}/enabled`, () => row.getByRole('button', { name: 'Enable' }).click());
  await expect(row).toContainText('Requester · Active');

  await row.getByRole('combobox', { name: `Role for ${username}` }).selectOption('SUPPORT');
  await mutate(page, 'PATCH', `/api/accounts/${username}/role`, () => row.getByRole('button', { name: 'Save role' }).click());
  await expect(row).toContainText('Support · Active');

  const newPassword = `second-${randomUUID()}`;
  await row.getByLabel(`New password for ${username}`).fill(newPassword);
  await mutate(page, 'PUT', `/api/accounts/${username}/password`,
    () => row.getByRole('button', { name: 'Reset password' }).click(), 204);
  await expect(row.getByLabel(`New password for ${username}`)).toHaveValue('');
});

test('support can reset their own password but cannot disable or demote themselves', async ({ page, request }) => {
  const username = `self-${randomUUID().slice(0, 8)}`;
  const password = `first-${randomUUID()}`;
  await loginApi(request);
  const created = await request.post('/api/accounts', {
    headers: await csrfHeaders(request), data: { username, role: 'SUPPORT', password },
  });
  expect(created.status()).toBe(201);
  await signIn(page, username, password);
  await open(page);
  await page.getByRole('searchbox', { name: 'Search accounts' }).fill(username);
  const row = accountRow(page, username);
  await expect(row).toContainText(`${username} (you) · Support · Active`);
  await expect(row.getByRole('combobox')).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Disable' })).toHaveCount(0);

  const newPassword = `second-${randomUUID()}`;
  await row.getByLabel(`New password for ${username}`).fill(newPassword);
  await row.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByText('Your session ended. Sign in again.', { exact: true })).toBeVisible();
  await signIn(page, username, newPassword);
});

test('the account form checks input, shows server errors and is hidden from requesters', async ({ page }) => {
  await loginUi(page);
  await open(page);
  const username = page.getByRole('textbox', { name: 'Username', exact: true });
  const password = page.getByLabel('Initial password');
  const create = page.getByRole('button', { name: 'Create account', exact: true });
  await username.fill('Bad Name');
  await password.fill(`long-${randomUUID()}`);
  await create.click();
  await expect(page.getByRole('alert')).toContainText('lowercase letters');
  await username.fill('e2e-support');
  await password.fill('short');
  await create.click();
  await expect(page.getByRole('alert')).toContainText('at least 12 characters');
  await password.fill(`long-${randomUUID()}`);
  await mutate(page, 'POST', '/api/accounts', () => create.click(), 409);
  await expect(page.getByRole('alert')).toContainText('Account already exists');
  await expect(username).toHaveValue('e2e-support');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await loginUi(page, 'REQUESTER');
  await expect(page.getByText('Manage accounts', { exact: true })).toHaveCount(0);
  expect((await page.request.get('/api/accounts')).status()).toBe(403);
});
