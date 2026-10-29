import { expect } from '@playwright/test';

export async function csrfHeaders(request) {
  const response = await request.get('/api/session');
  expect(response.status()).toBe(200);
  const session = await response.json();
  return { [session.csrfHeaderName]: session.csrfToken };
}

export async function loginApi(request, role = 'SUPPORT') {
  const response = await request.post('/api/session/login', {
    form: { username: `e2e-${role.toLowerCase()}`, password: process.env[`E2E_${role}_PASSWORD`] },
    headers: await csrfHeaders(request),
  });
  expect(response.status(), 'Fixture login must succeed').toBe(204);
}

export async function loginUi(page, role = 'SUPPORT') {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(`e2e-${role.toLowerCase()}`);
  await page.getByLabel('Password', { exact: true }).fill(process.env[`E2E_${role}_PASSWORD`]);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.getByText(`e2e-${role.toLowerCase()} · ${role === 'SUPPORT' ? 'support' : 'requester'}`, { exact: true })).toBeVisible();
}
