import { expect, request } from '@playwright/test';
import { loginApi } from './tests/auth.js';

export default async function waitForStack(config) {
  const api = await request.newContext({ baseURL: config.projects[0].use.baseURL, timeout: 5000 });
  try {
    await expect.poll(async () => {
      try {
        const health = await api.get('/actuator/health/readiness', { timeout: 5000 });
        if (!health.ok()) return `Readiness HTTP ${health.status()}`;
        if ((await health.json()).status !== 'UP') return 'Readiness is not UP';
        const home = await api.get('/');
        await loginApi(api);
        const queue = await api.get('/api/requests?limit=1');
        const staff = await api.get('/api/staff?limit=1');
        if (!home.ok() || !queue.ok() || !staff.ok()) return 'Frontend/API route not ready';
        if (!(await home.text()).includes('Service requests')) return 'Dashboard not ready';
        const queuePage = await queue.json();
        const staffPage = await staff.json();
        if (!Array.isArray(queuePage.items) || !Array.isArray(staffPage.items)) return 'Invalid API pages';
        return 'ready';
      } catch (error) {
        return error.message;
      }
    }, { message: 'Waiting for nginx, the API, migrations and PostgreSQL', timeout: 120_000,
      intervals: [250, 500, 1000] }).toBe('ready');

    expect((await (await api.get('/api/requests?limit=1')).json()).counts.total,
      'The test database must start empty').toBe(0);
    expect((await (await api.get('/api/staff?limit=1')).json()).items).toEqual([]);
  } finally {
    await api.dispose();
  }
}
