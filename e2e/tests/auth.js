import { expect } from '@playwright/test';

export async function csrfHeaders(request) {
  const response = await request.get('/api/session');
  expect(response.status()).toBe(200);
  const session = await response.json();
  return { [session.csrfHeaderName]: session.csrfToken };
}

export async function loginApi(request, role = 'SUPPORT') {
  const response = await request.post('/api/session/login', {
    form: { username: `e2e-${role.toLowerCase()}`, password: process.env.E2E_PASSWORD },
    headers: await csrfHeaders(request),
  });
  expect(response.status(), 'Fixture login must succeed').toBe(204);
}

export async function loginUi(page, role = 'SUPPORT') {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(`e2e-${role.toLowerCase()}`);
  await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.locator('.signed-in')).toHaveText(`Signed in as e2e-${role.toLowerCase()} ${role === 'SUPPORT' ? 'Support' : 'Requester'}`);
}

export async function api(request, method, path, data) {
  const response = await request.fetch(path, { method, data, headers: method === 'GET' ? {} : await csrfHeaders(request) });
  expect(response.status(), await response.text()).toBe(method === 'POST' ? 201 : 200);
  return response.json();
}

export async function mutate(page, method, path, action, status = method === 'POST' ? 201 : 200) {
  const [response] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === path
      && r.request().method() === method),
    action(),
  ]);
  expect(response.status(), await response.text()).toBe(status);
  return status === 204 ? null : response.json();
}
