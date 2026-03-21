import { expect, test } from "@playwright/test";

/**
 * E2E tests for the Monica Companion onboarding UI.
 *
 * Expects the Docker Compose stack to be running (docker compose --profile app up -d).
 * Caddy routes /setup* to web-ui on port 4321.
 *
 * These tests verify page rendering, theme switching, timezone picker,
 * client-side validation, and the success/error pages.
 */

// -- Error state (invalid token) -----------------------------------------------

test.describe("setup page — invalid token", () => {
	test("shows error message for fake token", async ({ page }) => {
		await page.goto("/setup/fake-token?sig=fake-sig");
		await expect(page.locator("h1")).toHaveText("Setup Error");
		await expect(page.locator("text=An error occurred")).toBeVisible();
	});

	test("shows error when sig param is missing", async ({ page }) => {
		await page.goto("/setup/fake-token");
		await expect(page.locator("h1")).toHaveText("Setup Error");
		await expect(page.locator("text=Invalid setup link")).toBeVisible();
	});
});

// -- Success page --------------------------------------------------------------

test.describe("success page", () => {
	test("renders success message", async ({ page }) => {
		await page.goto("/setup/success");
		await expect(page.locator("h1")).toHaveText("You're all set!");
		await expect(page.locator("text=Return to Telegram")).toBeVisible();
	});

	test("shows example prompt suggestion", async ({ page }) => {
		await page.goto("/setup/success");
		await expect(page.locator("text=Add a note to John")).toBeVisible();
	});
});

// -- Error page ----------------------------------------------------------------

test.describe("error page", () => {
	test("shows expired message for expired reason", async ({ page }) => {
		await page.goto("/setup/error?reason=expired");
		await expect(page.locator("h1")).toHaveText("Setup Error");
		await expect(page.locator("text=expired")).toBeVisible();
	});

	test("shows fallback message for unknown reason", async ({ page }) => {
		await page.goto("/setup/error?reason=something_unknown");
		await expect(page.locator("text=Something went wrong")).toBeVisible();
	});

	test("does not render raw query params (XSS prevention)", async ({ page }) => {
		await page.goto("/setup/error?reason=<script>alert(1)</script>");
		const content = await page.textContent("body");
		expect(content).not.toContain("<script>");
		await expect(page.locator("text=Something went wrong")).toBeVisible();
	});

	test("shows /start hint", async ({ page }) => {
		await page.goto("/setup/error?reason=expired");
		await expect(page.locator("code", { hasText: "/start" })).toBeVisible();
	});
});

// -- Theme switching -----------------------------------------------------------

test.describe("theme", () => {
	test("respects system dark mode preference", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto("/setup/success");
		const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		// Dark mode background should be very dark (near black)
		expect(bg).toMatch(/rgb\(\s*10,\s*10,\s*11\s*\)/);
	});

	test("respects system light mode preference", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await page.goto("/setup/success");
		const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
		// Light mode background should be white
		expect(bg).toMatch(/rgb\(\s*255,\s*255,\s*255\s*\)/);
	});

	test("manual toggle switches theme", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await page.goto("/setup/success");
		await page.waitForLoadState("networkidle");

		// Initially light — data-theme should not be "dark"
		const initialTheme = await page.evaluate(() =>
			document.documentElement.getAttribute("data-theme"),
		);
		expect(initialTheme).not.toBe("dark");

		// Click theme toggle
		await page.click("#theme-toggle");
		await page.waitForFunction(
			() => document.documentElement.getAttribute("data-theme") === "dark",
		);

		// data-theme should now be "dark"
		const newTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
		expect(newTheme).toBe("dark");

		// Toggle back
		await page.click("#theme-toggle");
		await page.waitForFunction(
			() => document.documentElement.getAttribute("data-theme") === "light",
		);
		const revertedTheme = await page.evaluate(() =>
			document.documentElement.getAttribute("data-theme"),
		);
		expect(revertedTheme).toBe("light");
	});

	test("theme preference persists in localStorage", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "light" });
		await page.goto("/setup/success");
		await page.waitForLoadState("networkidle");

		await page.click("#theme-toggle");
		await page.waitForFunction(
			() => document.documentElement.getAttribute("data-theme") === "dark",
		);

		const stored = await page.evaluate(() => localStorage.getItem("theme"));
		expect(stored).toBe("dark");
	});
});

// -- Layout & branding ---------------------------------------------------------

test.describe("layout", () => {
	test("shows Monica Companion branding", async ({ page }) => {
		await page.goto("/setup/success");
		await expect(page.locator("text=Monica Companion").first()).toBeVisible();
	});

	test("shows footer", async ({ page }) => {
		await page.goto("/setup/success");
		await expect(page.locator("footer")).toContainText("personal CRM assistant");
	});

	test("has theme toggle button", async ({ page }) => {
		await page.goto("/setup/success");
		await expect(page.locator("#theme-toggle")).toBeVisible();
	});
});
