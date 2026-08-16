import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test.describe.configure({ mode: "serial" });

test("approval input resumes durable work", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `approval-${stamp}@rakazo.test`, "password12", "Approval");
  await completeOnboarding(page, ["A bit of everything", "Clear and tight"]);

  const composer = page.getByPlaceholder(/Message/);
  await composer.fill("ask me which city to use");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Which city should I use?", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Reply with one city name.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send it" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit first" })).toBeVisible();
  await captureScreenshot(page, testInfo, "20-approval-input-request");

  await page.getByRole("button", { name: "Edit first" }).click();
  const answer = page.getByRole("textbox", { name: "Answer" });
  await answer.fill("Paris");
  await expect(page.getByRole("button", { name: "Send answer" })).toBeEnabled();
  await captureScreenshot(page, testInfo, "21-approval-custom-answer");
  await page.getByRole("button", { name: "Send answer" }).click();

  const resumed = page.getByText(
    "on it. i will work this in the background and come back with a result.",
    { exact: true },
  );
  await expect(resumed).toBeVisible({ timeout: 30_000 });
  const handledAnswer = page.getByText("done. i handled: Paris", { exact: true });
  await expect(handledAnswer).toBeVisible();
  await expect(page.getByText("Answered", { exact: true })).toBeVisible();

  await page.reload();
  await expect(resumed).toBeVisible({ timeout: 20_000 });
  await expect(handledAnswer).toBeVisible();
  await expect(page.getByText("Answered", { exact: true })).toBeVisible();
  await captureScreenshot(page, testInfo, "22-approval-resumed-after-reload");
});
