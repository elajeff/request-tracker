import { test, expect } from '@playwright/test';
import { loginApi, loginUi, csrfHeaders } from './auth.js';

const cards = page => page.getByRole('region', { name: 'Request queue' }).getByRole('article');
const card = (page, title) => page.getByRole('article', { name: title, exact: true });
const titles = page => cards(page).getByRole('heading', { level: 3 });
const historyValues = history => history.getByRole('listitem').getByRole('paragraph');

async function api(request, method, path, data) {
  const response = await request.fetch(path, { method, data, headers: method === 'GET' ? {} : await csrfHeaders(request) });
  expect(response.status(), await response.text()).toBe(method === 'POST' ? 201 : 200);
  return response.json();
}

async function mutate(page, method, path, action) {
  const [response] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === path
      && response.request().method() === method),
    action(),
  ]);
  expect(response.status(), await response.text()).toBe(method === 'POST' ? 201 : 200);
  return response.json();
}

function queueResponse(page, parameters) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/requests' && response.request().method() === 'GET'
      && !url.searchParams.has('cursor')
      && Object.entries(parameters).every(([key, value]) => url.searchParams.get(key) === value);
  });
}

async function search(page, query) {
  const [response] = await Promise.all([
    queueResponse(page, { q: query }),
    page.getByRole('searchbox', { name: 'Search requests' }).fill(query),
  ]);
  expect(response.status()).toBe(200);
}

async function filter(page, value) {
  const [response] = await Promise.all([
    queueResponse(page, { staffId: value && value !== 'unassigned' ? value : null,
      unassigned: value === 'unassigned' ? 'true' : null }),
    page.getByRole('combobox', { name: 'Filter by assigned staff' }).selectOption(value),
  ]);
  expect(response.status()).toBe(200);
}

async function create(page, title, description = 'Initial details') {
  const form = page.getByRole('complementary', { name: 'Create request' });
  await form.getByRole('textbox', { name: /^Title/ }).fill(title);
  await form.getByRole('textbox', { name: /^Description/ }).fill(description);
  const created = await mutate(page, 'POST', '/api/requests',
    () => form.getByRole('button', { name: 'Create request', exact: true }).click());
  await expect(card(page, title)).toContainText(description);
  return created;
}

test.beforeEach(async ({ page, request }) => {
  await loginApi(request);
  await loginUi(page);
});

test('create and edit a request, then reload its saved details', async ({ page, request }) => {
  await search(page, 'e2e-create');
  const created = await create(page, 'e2e-create initial', 'Original description');
  const original = card(page, created.title);
  await original.getByRole('button', { name: `Edit details for ${created.title}` }).click();
  await original.getByRole('textbox', { name: 'Title', exact: true }).fill('e2e-create edited');
  await original.getByRole('textbox', { name: 'Description', exact: true }).fill('Saved description');
  await mutate(page, 'PUT', `/api/requests/${created.id}`,
    () => original.getByRole('button', { name: 'Save changes' }).click());
  await expect(card(page, created.title)).toHaveCount(0);
  await expect(card(page, 'e2e-create edited')).toContainText('Saved description');

  await page.reload();
  await search(page, 'e2e-create');
  await expect(titles(page)).toHaveText(['e2e-create edited']);
  await expect(card(page, 'e2e-create edited')).toContainText('Saved description');
  expect(await api(request, 'GET', `/api/requests/${created.id}`)).toMatchObject({
    id: created.id, title: 'e2e-create edited', description: 'Saved description',
  });
});

test('create staff, assign and unassign requests, and filter the queue', async ({ page, request }) => {
  await search(page, 'e2e-assignment');
  const assigned = await create(page, 'e2e-assignment allocated');
  const waiting = await create(page, 'e2e-assignment waiting');
  await page.getByText('Manage support staff', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Staff name' }).fill('E2E assignment staff');
  const person = await mutate(page, 'POST', '/api/staff',
    () => page.getByRole('button', { name: 'Create staff', exact: true }).click());
  expect(person).toMatchObject({ name: 'E2E assignment staff', active: true });
  const assignedCard = card(page, assigned.title);
  await assignedCard.getByRole('combobox', { name: `Assigned staff for ${assigned.title}` }).selectOption(person.id);
  await mutate(page, 'PATCH', `/api/requests/${assigned.id}/assignment`,
    () => assignedCard.getByRole('button', { name: 'Save assignment' }).click());

  await page.reload();
  await search(page, 'e2e-assignment');
  await expect(assignedCard.getByRole('combobox', { name: `Assigned staff for ${assigned.title}` })).toHaveValue(person.id);
  expect(await api(request, 'GET', `/api/requests/${assigned.id}`)).toMatchObject({
    assigneeId: person.id, assignee: person.name,
  });
  await filter(page, person.id);
  await expect(titles(page)).toHaveText([assigned.title]);
  await filter(page, 'unassigned');
  await expect(titles(page)).toHaveText([waiting.title]);

  await filter(page, '');
  await assignedCard.getByRole('combobox', { name: `Assigned staff for ${assigned.title}` }).selectOption('');
  await mutate(page, 'PATCH', `/api/requests/${assigned.id}/assignment`,
    () => assignedCard.getByRole('button', { name: 'Save assignment' }).click());
  await filter(page, person.id);
  await expect(cards(page)).toHaveCount(0);
  await filter(page, 'unassigned');
  await expect(titles(page)).toHaveText([waiting.title, assigned.title]);
});

test('status and priority changes persist with before/after history', async ({ page, request }) => {
  await search(page, 'e2e-history');
  const created = await create(page, 'e2e-history changes');
  const item = card(page, created.title);
  await mutate(page, 'PATCH', `/api/requests/${created.id}/priority`,
    () => item.getByRole('combobox', { name: `Priority for ${created.title}` }).selectOption('HIGH'));
  await expect(item.getByRole('combobox', { name: `Priority for ${created.title}` })).toHaveValue('HIGH');
  for (const status of ['IN_PROGRESS', 'RESOLVED']) {
    await mutate(page, 'PATCH', `/api/requests/${created.id}/status`,
      () => item.getByRole('combobox', { name: `Status for ${created.title}` }).selectOption(status));
    await expect(item.getByRole('combobox', { name: `Status for ${created.title}` })).toHaveValue(status);
  }
  await page.reload();
  await search(page, 'e2e-history');
  await expect(item.getByRole('combobox', { name: `Status for ${created.title}` })).toBeDisabled();
  await expect(item.getByRole('combobox', { name: `Priority for ${created.title}` })).toHaveValue('HIGH');
  await item.getByText('Change history', { exact: true }).click();
  const history = item.getByRole('list', { name: `Change history for ${created.title}` });
  await expect(history.getByRole('listitem')).toHaveText([
    /status.*IN_PROGRESS → RESOLVED/s,
    /status.*NEW → IN_PROGRESS/s,
    /priority.*MEDIUM → HIGH/s,
    /created.*Created: e2e-history changes/s,
  ]);
  expect(await api(request, 'GET', `/api/requests/${created.id}`)).toMatchObject({
    status: 'RESOLVED', priority: 'HIGH',
  });
});

test('search and staff filters paginate queue and history without shifts or duplicates', async ({ page, request }) => {
  const person = await api(request, 'POST', '/api/staff', { name: 'E2E pages primary' });
  const other = await api(request, 'POST', '/api/staff', { name: 'E2E pages other' });
  const matching = [];
  for (let index = 0; index < 31; index++) {
    const row = await api(request, 'POST', '/api/requests', {
      title: `e2e-pages-match ${String(index).padStart(2, '0')}`, description: 'Initial details',
    });
    await api(request, 'PATCH', `/api/requests/${row.id}/assignment`, { staffId: person.id });
    matching.push(row);
  }
  const excluded = [];
  for (const [title, staffId] of [['e2e-pages-match other', other.id],
    ['e2e-pages-match unassigned', null], ['e2e-pages-unrelated', person.id]]) {
    const row = await api(request, 'POST', '/api/requests', { title, description: 'Filter decoy' });
    if (staffId) await api(request, 'PATCH', `/api/requests/${row.id}/assignment`, { staffId });
    excluded.push(row);
  }
  const oldest = matching[0];
  for (let index = 1; index <= 26; index++) {
    await api(request, 'PUT', `/api/requests/${oldest.id}`, {
      title: oldest.title, description: `Saved revision ${String(index).padStart(2, '0')}`,
    });
  }
  await page.reload();
  await page.getByText('Manage support staff', { exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search staff' }).fill('E2E pages');
  await expect(page.getByRole('combobox', { name: 'Filter by assigned staff' })
    .locator('option', { hasText: other.id })).toHaveCount(1);
  await search(page, 'e2e-pages-match');
  await filter(page, person.id);
  const expectedTitles = matching.map(row => row.title).reverse();
  await expect(titles(page)).toHaveText(expectedTitles.slice(0, 25));

  const arrival = await api(request, 'POST', '/api/requests', {
    title: 'e2e-pages-match new arrival', description: 'Arrived after page one',
  });
  await api(request, 'PATCH', `/api/requests/${arrival.id}/assignment`, { staffId: person.id });
  await page.getByRole('button', { name: 'Load more requests' }).click();
  await expect(titles(page)).toHaveText(expectedTitles);
  expect(new Set(await titles(page).allTextContents()).size).toBe(31);
  await expect(page.getByRole('button', { name: 'Load more requests' })).toBeHidden();
  await filter(page, other.id);
  await expect(titles(page)).toHaveText([excluded[0].title]);
  await filter(page, 'unassigned');
  await expect(titles(page)).toHaveText([excluded[1].title]);
  await filter(page, person.id);
  await expect(titles(page)).toHaveText([arrival.title, ...expectedTitles].slice(0, 25));
  await search(page, oldest.title);
  await expect(titles(page)).toHaveText([oldest.title]);

  const before = await api(request, 'GET', `/api/requests/${oldest.id}/history?limit=100`);
  const values = before.items.map(entry => entry.field === 'CREATED' ? `Created: ${entry.newValue}`
    : `${entry.oldValue ?? 'Unassigned'} → ${entry.newValue ?? 'Unassigned'}`);
  expect(before.items).toHaveLength(28);
  const item = card(page, oldest.title);
  await item.getByText('Change history', { exact: true }).click();
  const history = item.getByRole('list', { name: `Change history for ${oldest.title}` });
  await expect(historyValues(history)).toHaveText(values.slice(0, 25));
  await api(request, 'PUT', `/api/requests/${oldest.id}`, { title: oldest.title, description: 'Newest revision' });
  await item.getByRole('button', { name: 'Load older changes' }).click();
  await expect(historyValues(history)).toHaveText(values);
  expect(new Set(await historyValues(history).allTextContents()).size).toBe(28);
  await expect(item.getByRole('button', { name: 'Load older changes' })).toBeHidden();
  await item.getByRole('button', { name: 'Refresh history' }).click();
  const refreshed = ['Saved revision 26 → Newest revision', ...values];
  await expect(historyValues(history)).toHaveText(refreshed.slice(0, 25));
  await item.getByRole('button', { name: 'Load older changes' }).click();
  await expect(historyValues(history)).toHaveText(refreshed);
  expect(new Set(await historyValues(history).allTextContents()).size).toBe(29);
});
