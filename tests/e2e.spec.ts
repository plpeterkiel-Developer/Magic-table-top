import { test, expect, type Page } from '@playwright/test';

// Each test run uses a fresh suffix so we don't collide with prior test users.
const SUFFIX = Date.now();
const PASSWORD = 'testpassword123';

async function signUp(page: Page, email: string, displayName: string) {
  await page.goto('/');
  // The "Sign up" tab on the auth card.
  await page.getByRole('button', { name: 'Sign up' }).first().click();
  await page.getByLabel('Display name').fill(displayName);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  // We've landed in the lobby when the "Start a new game" card is visible.
  await expect(page.getByRole('heading', { name: 'Start a new game' })).toBeVisible({
    timeout: 20_000,
  });
}

test('token create + delete updates UI in realtime (no refresh)', async ({ page }) => {
  const email = `pw-token-${SUFFIX}@example.com`;
  await signUp(page, email, `PW Token ${SUFFIX}`);

  // Create a game as host.
  await page.getByRole('button', { name: 'Create game' }).click();
  await expect(page.getByText('Room code:')).toBeVisible({ timeout: 15_000 });

  // Create a token on the battlefield. Default name is "1/1 Soldier".
  await page.getByRole('button', { name: '+ Token' }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  const token = page.locator('.card.token').filter({ hasText: '1/1 Soldier' });
  await expect(token).toBeVisible();

  // Open the card menu and delete.
  await token.click();
  await page.getByRole('button', { name: 'Delete token' }).click();

  // Without the replica-identity-full fix, the DELETE realtime event is
  // dropped and the DOM never updates. With the fix, the token vanishes
  // within ~1s. Generous timeout to allow for cold realtime channel.
  await expect(token).toHaveCount(0, { timeout: 5_000 });
});

test('second player joins by room code and both see 2 seated', async ({ browser }) => {
  const email1 = `pw-host-${SUFFIX}@example.com`;
  const email2 = `pw-joiner-${SUFFIX}@example.com`;

  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const page1 = await ctx1.newPage();
  const page2 = await ctx2.newPage();

  await Promise.all([
    signUp(page1, email1, 'Host'),
    signUp(page2, email2, 'Joiner'),
  ]);

  // Host creates a game.
  await page1.getByRole('button', { name: 'Create game' }).click();
  await expect(page1.getByText('Room code:')).toBeVisible({ timeout: 15_000 });
  const roomCode = (await page1.locator('code.room-code').textContent())?.trim();
  expect(roomCode).toMatch(/^[A-Z0-9]{6}$/);

  // Joiner enters the room code and joins.
  await page2.getByLabel('Room code').fill(roomCode!);
  await page2.getByRole('button', { name: 'Join game' }).click();

  // Without the game_players SELECT fix, person 2's join would either
  // collide on seat 0 (unique violation) or silently end up at a wrong
  // seat. With the fix, both see "2 seated" within ~1s.
  await expect(page1.getByText('2 seated')).toBeVisible({ timeout: 10_000 });
  await expect(page2.getByText('2 seated')).toBeVisible({ timeout: 10_000 });

  await ctx1.close();
  await ctx2.close();
});
