import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loginApi, loginUi, csrfHeaders } from "./auth.js";

async function api(request, method, path, data) {
  const r = await request.fetch(path, {
    method,
    data,
    headers: method === "GET" ? {} : await csrfHeaders(request),
  });
  expect(r.status()).toBe(method === "POST" ? 201 : 200);
  return r.json();
}
const titles = (page) =>
  page
    .getByRole("region", { name: "Request queue" })
    .getByRole("heading", { level: 3 });
const directory = (page) => page.getByRole("form", { name: /^Staff / });

test("status finds older matches before pagination and combines with search and staff filters", async ({
  page,
  request,
}) => {
  await loginApi(request);
  const token = `queue-filter-${randomUUID().slice(0, 8)}`;
  const person = await api(request, "POST", "/api/staff", { name: token });
  const older = [];
  for (let i = 0; i < 3; i++) {
    const row = await api(request, "POST", "/api/requests", {
      title: `${token} older ${i}`,
      description: "Complete queue filtering",
    });
    await api(request, "PATCH", `/api/requests/${row.id}/status`, {
      status: "IN_PROGRESS",
    });
    older.push(row);
  }
  await api(request, "PATCH", `/api/requests/${older[0].id}/assignment`, {
    staffId: person.id,
  });
  for (let i = 0; i < 28; i++)
    await api(request, "POST", "/api/requests", {
      title: `${token} newer ${i}`,
      description: "New decoy",
    });
  await loginUi(page);
  await page.getByRole("searchbox", { name: "Search requests" }).fill(token);
  await expect(titles(page)).toHaveCount(25);
  await page.getByText("Manage support staff", { exact: true }).click();
  await page.getByRole("searchbox", { name: "Search staff" }).fill(token);
  await expect(directory(page)).toHaveCount(1);
  const filtered = page.waitForResponse((r) => {
    const u = new URL(r.url());
    return (
      u.pathname === "/api/requests" &&
      u.searchParams.get("status") === "IN_PROGRESS" &&
      u.searchParams.get("q") === token &&
      !u.searchParams.has("cursor")
    );
  });
  await page
    .getByRole("combobox", { name: "Filter by status", exact: true })
    .selectOption("IN_PROGRESS");
  expect((await filtered).status()).toBe(200);
  await expect(titles(page)).toHaveText(older.map((r) => r.title).reverse());
  await page
    .getByRole("combobox", { name: "Filter by assigned staff" })
    .selectOption(person.id);
  await expect(titles(page)).toHaveText([older[0].title]);
  await page
    .getByRole("combobox", { name: "Filter by assigned staff" })
    .selectOption("unassigned");
  await expect(titles(page)).toHaveText([older[2].title, older[1].title]);
  await page.screenshot({
    path: "/results/filtering-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/results/filtering-narrow.png",
    fullPage: true,
  });
  await page
    .getByRole("combobox", { name: "Filter by status", exact: true })
    .selectOption("");
  await expect(titles(page)).toHaveCount(25);
});

test("staff backend search stays paginated, resets when cleared and rejects slower old responses", async ({
  page,
  request,
}) => {
  await loginApi(request);
  const token = `directory-filter-${randomUUID().slice(0, 8)}`;
  const people = [];
  for (let i = 0; i < 35; i++)
    people.push(
      await api(request, "POST", "/api/staff", {
        name: `${token} ${String(i).padStart(2, "0")}`,
      }),
    );
  people.sort((a, b) => a.id.localeCompare(b.id));
  const target = people.at(-1);
  await loginUi(page);
  await page.getByText("Manage support staff", { exact: true }).click();
  await expect(directory(page)).toHaveCount(25);
  await expect(
    page.getByRole("form", {
      name: `Staff ${target.name} ${target.id}`,
      exact: true,
    }),
  ).toHaveCount(0);
  const searches = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/staff") searches.push(u);
  });
  await page.getByRole("searchbox", { name: "Search staff" }).fill(token);
  await expect(directory(page)).toHaveCount(25);
  await expect(
    page.getByRole("button", { name: "Load more staff" }),
  ).toBeVisible();
  expect(
    searches.filter(
      (u) => u.searchParams.get("q") === token && u.searchParams.has("cursor"),
    ),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Load more staff" }).click();
  await expect(directory(page)).toHaveCount(35);
  await page.getByRole("searchbox", { name: "Search staff" }).fill("");
  await expect(directory(page)).toHaveCount(25);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/staff?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") === token) {
      const response = await route.fetch();
      await held;
      await route.fulfill({ response }).catch(() => {});
    } else await route.continue();
  });
  const pending = page.waitForRequest(
    (r) =>
      new URL(r.url()).pathname === "/api/staff" &&
      new URL(r.url()).searchParams.get("q") === token,
  );
  await page.getByRole("searchbox", { name: "Search staff" }).fill(token);
  await pending;
  await page.getByRole("searchbox", { name: "Search staff" }).fill(target.name);
  await expect(directory(page)).toHaveCount(1);
  await expect(
    page.getByRole("form", {
      name: `Staff ${target.name} ${target.id}`,
      exact: true,
    }),
  ).toBeVisible();
  release();
  await expect(directory(page)).toHaveCount(1);
  expect(searches.some((u) => u.searchParams.get("q") === target.name)).toBe(
    true,
  );
});
