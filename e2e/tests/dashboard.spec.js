import { test, expect } from '@playwright/test';
import { loginApi, loginUi, csrfHeaders } from './auth.js';

async function seed(request, title) {
  await loginApi(request);
  const response = await request.post('/api/requests',
    { headers: await csrfHeaders(request), data: { title, description: 'Dashboard migration' } });
  expect(response.status()).toBe(201);
  return response.json();
}

test('queue loading, failed refresh and delayed search preserve newer state and edit drafts', async ({ page, request }) => {
  const row = await seed(request, 'dashboard-race original');
  await loginUi(page);
  const card = page.getByRole('article', { name: row.title, exact: true });
  await card.getByRole('button', { name: `Edit details for ${row.title}` }).click();
  await card.getByRole('textbox', { name: 'Title', exact: true }).fill('Unsaved title');
  await page.route('**/api/requests?*', route => route.fulfill({ status: 503, json: { detail: 'Queue unavailable' } }));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Queue unavailable' })).toBeVisible();
  await expect(card.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Unsaved title');
  await expect(page.getByText('API unavailable', { exact: true })).toBeVisible();
  await page.unroute('**/api/requests?*');
  await page.getByRole('button', { name: 'Retry loading requests' }).click();
  await expect(page.getByRole('button', { name: 'Retry loading requests' })).toHaveCount(0);
  await expect(card.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Unsaved title');
  let release, finish;
  const held = new Promise(resolve => {
    release = resolve;
  });
  const finished = new Promise(resolve => {
    finish = resolve;
  });
  await page.route('**/api/requests?*', async route => {
    if (new URL(route.request().url()).searchParams.get('q') === 'dashboard-race') {
      const response = await route.fetch();
      await held;
      await route.fulfill({ response }).catch(() => {});
      finish();
    } else await route.continue();
  });
  const dispatched = page.waitForRequest(r => new URL(r.url()).searchParams.get('q') === 'dashboard-race');
  await page.getByRole('searchbox', { name: 'Search requests' }).fill('dashboard-race');
  await dispatched;
  await expect(page.getByText('Loading requests…', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search requests' }).fill('dashboard-no-match');
  await expect(page.getByText('No matching requests', { exact: true })).toBeVisible();
  release();
  await finished;
  await expect(card).toHaveCount(0);
});

test('a save during the first history load shows up without refreshing the history', async ({ page, request }) => {
  const row = await seed(request, 'dashboard-history-race');
  await loginUi(page);
  const card = page.getByRole('article', { name: row.title, exact: true });
  let release, capture;
  const held = new Promise(resolve => {
    release = resolve;
  });
  const captured = new Promise(resolve => {
    capture = resolve;
  });
  await page.route(`**/api/requests/${row.id}/history?*`, async route => {
    const response = await route.fetch();
    capture();
    await held;
    await route.fulfill({ response }).catch(() => {});
  }, { times: 1 });
  await card.getByText('Change history', { exact: true }).click();
  await captured;
  await card.getByRole('combobox', { name: `Priority for ${row.title}` }).selectOption('HIGH');
  await card.getByRole('button', { name: `Save priority for ${row.title}` }).click();
  await expect(card.locator('.pill.priority-high')).toBeVisible();
  release();
  const history = card.getByRole('list', { name: `Change history for ${row.title}` });
  await expect(history.getByRole('listitem').first()).toHaveText(/priority.*Medium → High/s);
});

test('request validation, forbidden and not-found errors retain drafts for manual retry', async ({ page, request }) => {
  const row = await seed(request, 'dashboard-errors');
  await loginUi(page);
  const card = page.getByRole('article', { name: row.title, exact: true });
  await card.getByRole('button', { name: `Edit details for ${row.title}` }).click();
  const title = card.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('   ');
  await card.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('#notice')).toContainText('Enter both');
  await title.fill('dashboard-errors saved');
  for (const status of [403, 404]) {
    await page.route(`**/api/requests/${row.id}`, route =>
      route.fulfill({ status, json: { detail: status === 403 ? 'Access denied' : 'Request not found' } }));
    await card.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('#notice')).toContainText(status === 403 ? 'Access denied' : 'Request not found');
    await expect(title).toHaveValue('dashboard-errors saved');
    await expect(card.getByRole('button', { name: 'Save changes' })).toBeFocused();
    await page.unroute(`**/api/requests/${row.id}`);
  }
  await card.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('article', { name: 'dashboard-errors saved', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit details for dashboard-errors saved' })).toBeFocused();
});

test('late queue responses cannot restore protected content after session loss', async ({ page, request }) => {
  const row = await seed(request, 'dashboard-private-late');
  let staffReads = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/staff') staffReads++;
  });
  const initialStaff = page.waitForResponse(response => new URL(response.url()).pathname === '/api/staff' && response.status() === 200);
  await loginUi(page);
  await initialStaff;
  await expect(page.getByRole('article', { name: row.title, exact: true }).first()).toBeVisible();
  await page.getByText('Manage support staff', { exact: true }).click();
  const refreshStaff = page.getByRole('button', { name: 'Refresh staff' });
  await expect(refreshStaff).toBeEnabled();
  let release, capture, finish;
  const held = new Promise(resolve => {
    release = resolve;
  });
  const captured = new Promise(resolve => {
    capture = resolve;
  });
  const finished = new Promise(resolve => {
    finish = resolve;
  });
  await page.route('**/api/requests?*', async route => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect((await response.json()).items.some(item => item.id === row.id)).toBe(true);
    capture();
    await held;
    await route.fulfill({ response }).catch(() => {});
    finish();
  });
  try {
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await captured;
    expect((await page.request.post('/api/session/logout', { headers: await csrfHeaders(page.request) })).status()).toBe(204);
    const denied = page.waitForResponse(response => new URL(response.url()).pathname === '/api/staff' && response.status() === 401);
    await refreshStaff.click();
    await denied;
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.locator('#staff-directory')).toHaveCount(0);
    release();
    await finished;
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    expect(staffReads).toBe(2);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('dashboard desktop and narrow layouts retain labels and keyboard focus', async ({ page, request }) => {
  const row = await seed(request, 'dashboard-layout');
  const person = await (await request.post('/api/staff',
    { headers: await csrfHeaders(request), data: { name: 'dashboard-layout staff' } })).json();
  await loginUi(page);
  await page.getByRole('searchbox', { name: 'Search requests' }).fill(row.title);
  const card = page.getByRole('article', { name: row.title, exact: true });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: `Edit details for ${row.title}` }).click();
  await expect(card.getByRole('textbox', { name: 'Title', exact: true })).toBeFocused();
  await card.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(card.getByRole('button', { name: `Edit details for ${row.title}` })).toBeFocused();
  const priority = card.getByRole('combobox', { name: `Priority for ${row.title}` });
  const savePriority = card.getByRole('button', { name: `Save priority for ${row.title}` });
  await priority.selectOption('LOW');
  await savePriority.focus();
  await page.keyboard.press('Enter');
  await expect(card.locator('.pill.priority-low')).toBeVisible();
  await expect(priority).toBeFocused();
  await page.route(`**/api/requests/${row.id}/priority`, route => route.fulfill({ status: 500, json: { detail: 'Priority save failed' } }));
  await priority.selectOption('HIGH');
  await savePriority.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#notice')).toContainText('Priority save failed');
  await expect(savePriority).toBeFocused();
  const assignee = card.getByRole('combobox', { name: `Assigned staff for ${row.title}` });
  const saveAssignment = card.getByRole('button', { name: 'Save assignment' });
  await assignee.selectOption(person.id);
  await saveAssignment.focus();
  await page.keyboard.press('Enter');
  await expect(card).toContainText(`Assigned staff: ${person.name}`);
  await expect(saveAssignment).toBeDisabled();
  await expect(assignee).toBeFocused();
  await page.route(`**/api/requests/${row.id}/assignment`,
    route => route.fulfill({ status: 500, json: { detail: 'Assignment save failed' } }));
  await assignee.selectOption('');
  await saveAssignment.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#notice')).toContainText('Assignment save failed');
  await expect(saveAssignment).toBeFocused();
  for (const [width, height, name] of [[1440, 1000, 'desktop'], [390, 844, 'narrow']]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/results/dashboard-${name}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Username', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.screenshot({ path: '/results/login-narrow.png', fullPage: true });
});

test('request creation failures keep input and the created request appears once retried', async ({ page }) => {
  await loginUi(page);
  await page.getByRole('searchbox', { name: 'Search requests' }).fill('dashboard-status');
  const form = page.getByRole('complementary', { name: 'Create request' });
  await form.getByRole('textbox', { name: /^Title/ }).fill('dashboard-status created');
  await form.getByRole('textbox', { name: /^Description/ }).fill('Retained on failure');
  let calls = 0;
  await page.route('**/api/requests', route => {
    if (route.request().method() === 'POST') {
      calls++;
      return route.fulfill({ status: 503, json: { detail: 'Creation unavailable' } });
    }
    return route.continue();
  });
  await form.getByRole('button', { name: 'Create request', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Creation unavailable');
  await expect(form.getByRole('textbox', { name: /^Title/ })).toHaveValue('dashboard-status created');
  expect(calls).toBe(1);
  await page.unroute('**/api/requests');
  await form.getByRole('button', { name: 'Create request', exact: true }).click();
  await expect(page.getByRole('article', { name: 'dashboard-status created', exact: true })).toBeVisible();
});

test('assignment filters retain known staff beyond the first directory page', async ({ page, request }) => {
  const row = await seed(request, 'dashboard-known-staff');
  const people = [];
  for (let i = 0; i < 28; i++) {
    const response = await request.post('/api/staff', { headers: await csrfHeaders(request), data: { name: `Known staff ${i}` } });
    expect(response.status()).toBe(201);
    people.push(await response.json());
  }
  const first = await (await request.get('/api/staff?limit=25')).json();
  const person = people.find(p => !first.items.some(item => item.id === p.id));
  expect(person).toBeTruthy();
  expect((await request.patch(`/api/requests/${row.id}/assignment`,
    { headers: await csrfHeaders(request), data: { staffId: person.id } })).status()).toBe(200);
  await loginUi(page);
  await page.getByRole('searchbox', { name: 'Search requests' }).fill(row.title);
  const card = page.getByRole('article', { name: row.title, exact: true });
  await card.getByRole('combobox', { name: `Assigned staff for ${row.title}` }).selectOption('');
  await card.getByRole('button', { name: 'Save assignment' }).click();
  await expect(card).toContainText('Assigned staff: Unassigned');
  await page.getByRole('combobox', { name: 'Filter by assigned staff' }).selectOption(person.id);
  await expect(card).toHaveCount(0);
});
