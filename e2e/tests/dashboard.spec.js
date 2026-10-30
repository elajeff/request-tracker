import { test, expect } from "@playwright/test";
import { loginApi, loginUi, csrfHeaders } from "./auth.js";

async function seed(request, title) {
  await loginApi(request);
  const response = await request.post("/api/requests", {
    headers: await csrfHeaders(request),
    data: { title, description: "Dashboard migration" },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test("queue loading, failed refresh and delayed search preserve newer state and edit drafts", async ({
  page,
  request,
}) => {
  const row = await seed(request, "react-race original");
  await loginUi(page);
  const card = page.getByRole("article", { name: row.title, exact: true });
  await card
    .getByRole("button", { name: `Edit details for ${row.title}` })
    .click();
  await card
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Unsaved title");
  await page.route("**/api/requests?*", (route) =>
    route.fulfill({ status: 503, json: { detail: "Queue unavailable" } }),
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Queue unavailable" }),
  ).toBeVisible();
  await expect(
    card.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Unsaved title");
  await expect(
    page.getByText("API unavailable", { exact: true }),
  ).toBeVisible();
  await page.unroute("**/api/requests?*");
  await page.getByRole("button", { name: "Retry loading requests" }).click();
  await expect(
    page.getByRole("button", { name: "Retry loading requests" }),
  ).toHaveCount(0);
  await expect(
    card.getByRole("textbox", { name: "Title", exact: true }),
  ).toHaveValue("Unsaved title");
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/requests?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") === "react-race") {
      const response = await route.fetch();
      await held;
      await route.fulfill({ response }).catch(() => {});
    } else await route.continue();
  });
  const dispatched = page.waitForRequest(
    (r) => new URL(r.url()).searchParams.get("q") === "react-race",
  );
  await page
    .getByRole("searchbox", { name: "Search requests" })
    .fill("react-race");
  await dispatched;
  await expect(
    page.getByText("Loading requests…", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search requests" })
    .fill("react-no-match");
  await expect(
    page.getByText("No matching requests", { exact: true }),
  ).toBeVisible();
  release();
  await expect(card).toHaveCount(0);
});

test("request validation, forbidden and not-found errors retain drafts for manual retry", async ({
  page,
  request,
}) => {
  const row = await seed(request, "react-errors");
  await loginUi(page);
  const card = page.getByRole("article", { name: row.title, exact: true });
  await card
    .getByRole("button", { name: `Edit details for ${row.title}` })
    .click();
  const title = card.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("   ");
  await card.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("#notice")).toContainText("Enter both");
  await title.fill("react-errors saved");
  for (const status of [403, 404]) {
    await page.route(`**/api/requests/${row.id}`, (route) =>
      route.fulfill({
        status,
        json: {
          detail: status === 403 ? "Access denied" : "Request not found",
        },
      }),
    );
    await card.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("#notice")).toContainText(
      status === 403 ? "Access denied" : "Request not found",
    );
    await expect(title).toHaveValue("react-errors saved");
    await page.unroute(`**/api/requests/${row.id}`);
  }
  await card.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("article", { name: "react-errors saved", exact: true }),
  ).toBeVisible();
});

test("late queue responses cannot restore protected content after session loss", async ({
  page,
  request,
}) => {
  await seed(request, "react-private-late");
  await loginUi(page);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/requests?*", async (route) => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response }).catch(() => {});
  });
  const dispatched = page.waitForRequest(
    (r) => new URL(r.url()).pathname === "/api/requests",
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await dispatched;
  expect(
    (
      await page.request.post("/api/session/logout", {
        headers: await csrfHeaders(page.request),
      })
    ).status(),
  ).toBe(204);
  await page.getByText("Manage support staff", { exact: true }).click();
  await page.getByRole("button", { name: "Refresh staff" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  release();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("dashboard desktop and narrow layouts retain labels and keyboard focus", async ({
  page,
  request,
}) => {
  const row = await seed(request, "react-layout");
  await loginUi(page);
  await page
    .getByRole("searchbox", { name: "Search requests" })
    .fill(row.title);
  const card = page.getByRole("article", { name: row.title, exact: true });
  await expect(card).toBeVisible();
  await card
    .getByRole("button", { name: `Edit details for ${row.title}` })
    .click();
  await expect(
    card.getByRole("textbox", { name: "Title", exact: true }),
  ).toBeFocused();
  await card.getByRole("button", { name: "Cancel", exact: true }).click();
  for (const [width, height, name] of [
    [1440, 1000, "desktop"],
    [390, 844, "narrow"],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: `/results/dashboard-${name}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Username", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  await page.screenshot({ path: "/results/login-narrow.png", fullPage: true });
});

test("request creation failures keep input and status filtering queries the queue", async ({
  page,
  request,
}) => {
  const row = await seed(request, "react-status existing");
  await request.patch(`/api/requests/${row.id}/status`, {
    headers: await csrfHeaders(request),
    data: { status: "IN_PROGRESS" },
  });
  await loginUi(page);
  await page
    .getByRole("searchbox", { name: "Search requests" })
    .fill("react-status");
  const form = page.getByRole("complementary", { name: "Create request" });
  await form
    .getByRole("textbox", { name: /^Title/ })
    .fill("react-status created");
  await form
    .getByRole("textbox", { name: /^Description/ })
    .fill("Retained on failure");
  let calls = 0;
  await page.route("**/api/requests", (route) => {
    if (route.request().method() === "POST") {
      calls++;
      return route.fulfill({
        status: 503,
        json: { detail: "Creation unavailable" },
      });
    }
    return route.continue();
  });
  await form
    .getByRole("button", { name: "Create request", exact: true })
    .click();
  await expect(page.locator("#notice")).toContainText("Creation unavailable");
  await expect(form.getByRole("textbox", { name: /^Title/ })).toHaveValue(
    "react-status created",
  );
  expect(calls).toBe(1);
  await page.unroute("**/api/requests");
  await form
    .getByRole("button", { name: "Create request", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "react-status created", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Filter by status" })
    .selectOption("IN_PROGRESS");
  await expect(
    page.getByRole("article", { name: row.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "react-status created", exact: true }),
  ).toHaveCount(0);
});

test("assignment filters retain known staff beyond the first directory page", async ({
  page,
  request,
}) => {
  const row = await seed(request, "react-known-staff");
  const people = [];
  for (let i = 0; i < 28; i++) {
    const response = await request.post("/api/staff", {
      headers: await csrfHeaders(request),
      data: { name: `Known staff ${i}` },
    });
    expect(response.status()).toBe(201);
    people.push(await response.json());
  }
  const first = await (await request.get("/api/staff?limit=25")).json();
  const person = people.find(
    (p) => !first.items.some((item) => item.id === p.id),
  );
  expect(person).toBeTruthy();
  expect(
    (
      await request.patch(`/api/requests/${row.id}/assignment`, {
        headers: await csrfHeaders(request),
        data: { staffId: person.id },
      })
    ).status(),
  ).toBe(200);
  await loginUi(page);
  await page
    .getByRole("searchbox", { name: "Search requests" })
    .fill(row.title);
  const card = page.getByRole("article", { name: row.title, exact: true });
  await card
    .getByRole("combobox", { name: `Assigned staff for ${row.title}` })
    .selectOption("");
  await card.getByRole("button", { name: "Save assignment" }).click();
  await expect(card).toContainText("Assigned staff: Unassigned");
  await page
    .getByRole("combobox", { name: "Filter by assigned staff" })
    .selectOption(person.id);
  await expect(card).toHaveCount(0);
});
