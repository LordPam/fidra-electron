import fs from 'node:fs';
import path from 'node:path';
import { test, expect, assertSandboxed } from './fixtures';

/**
 * Before any test is allowed to trust its results, prove the app is running against
 * a throwaway home. Without this the suite would open whatever ledger the developer
 * last had open and write to it.
 */
test('runs against a sandboxed home, not the real one', async ({ window, userHome }) => {
  assertSandboxed(userHome);

  // The app created its state inside the sandbox...
  const sandboxDb = await window.evaluate(() => window.api.getDbPath());
  expect(sandboxDb.startsWith(path.join(userHome, '.fidra', 'accounts'))).toBe(true);
  await expect.poll(() => fs.existsSync(sandboxDb), {
    message: 'app should create its database inside the sandbox',
  }).toBe(true);

  // ...and the window is real.
  expect(await window.title()).toBeTruthy();
});

test('boots to a usable window without main-process errors', async ({ window, mainErrors }) => {
  // Something rendered, and it is not a blank page or an error screen
  const body = await window.locator('body').innerText();
  expect(body.length).toBeGreaterThan(0);
  expect(body).not.toContain('Startup Error');

  expect(mainErrors, `main process wrote to stderr:\n${mainErrors.join('\n')}`).toEqual([]);
});

test('opens a new local ledger from setup', async ({ window }) => {
  // By role, not text: the expanded sidebar also carries a "Dashboard" nav label.
  await expect(window.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
  await expect(window.getByText('CURRENT BALANCE')).toBeVisible();
  await expect(window.getByText('No recent transactions')).toBeVisible();
});

test('macOS title band keeps window controls, view title, and sidebar brand in separate zones', async ({ window }) => {
  const platform = await window.evaluate(() => window.api.platform);
  if (platform !== 'darwin') test.skip();

  const logo = window.getByTestId('sidebar-brand').locator('img:visible');
  const title = window.getByRole('heading', { name: 'Dashboard' });
  const viewHeader = title.locator('..');
  const sidebar = window.getByTestId('sidebar');
  const titlebar = window.getByTestId('sidebar-titlebar');
  const rail = window.getByTestId('sidebar-rail');
  const cornerUnderlay = window.getByTestId('sidebar-panel-corner-underlay');
  const panel = window.getByTestId('sidebar-panel-surface');
  const [logoBox, titleBox, viewHeaderBox, sidebarBox, titlebarBox, railBox, cornerUnderlayBox, panelBox] = await Promise.all([
    logo.boundingBox(),
    title.boundingBox(),
    viewHeader.boundingBox(),
    sidebar.boundingBox(),
    titlebar.boundingBox(),
    rail.boundingBox(),
    cornerUnderlay.boundingBox(),
    panel.boundingBox(),
  ]);

  expect(logoBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(viewHeaderBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(titlebarBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(cornerUnderlayBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  if (!logoBox || !titleBox || !viewHeaderBox || !sidebarBox || !titlebarBox || !railBox || !cornerUnderlayBox || !panelBox) {
    throw new Error('Expected visible sidebar and title geometry');
  }
  expect(titlebarBox.height).toBe(52);
  // The rail supplies the top-left corner material. The title band must begin
  // beside it rather than stacking another translucent layer over the rail.
  expect(titlebarBox.x).toBe(railBox.x + railBox.width);
  // The remaining pixel is the sidebar's right-hand separator border.
  expect(titlebarBox.x + titlebarBox.width).toBe(sidebarBox.x + sidebarBox.width - 1);
  expect(viewHeaderBox.height).toBe(titlebarBox.height);
  expect(viewHeaderBox.y + viewHeaderBox.height).toBe(titlebarBox.y + titlebarBox.height);
  expect(titleBox.y).toBeLessThan(titlebarBox.y + titlebarBox.height);
  expect(logoBox.y).toBeGreaterThanOrEqual(titlebarBox.y + titlebarBox.height + 12);
  expect(titleBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width + 20);
  expect(panelBox.x).toBe(railBox.x + railBox.width);
  expect(panelBox.y).toBe(titlebarBox.y + titlebarBox.height);
  expect(cornerUnderlayBox).toEqual({ x: panelBox.x, y: panelBox.y, width: 16, height: 16 });

  const [titlebarColor, railColor, cornerUnderlayColor, headerColor, panelRadius] = await Promise.all([
    titlebar.evaluate((element) => getComputedStyle(element).backgroundColor),
    rail.evaluate((element) => getComputedStyle(element).backgroundColor),
    cornerUnderlay.evaluate((element) => getComputedStyle(element).backgroundColor),
    viewHeader.evaluate((element) => getComputedStyle(element).backgroundColor),
    panel.evaluate((element) => getComputedStyle(element).borderTopLeftRadius),
  ]);
  expect(railColor).toBe(titlebarColor);
  expect(cornerUnderlayColor).toBe(railColor);
  expect(headerColor).toBe(titlebarColor);
  expect(panelRadius).toBe('16px');
  await expect(window.locator('html')).toHaveClass(/mac-vibrancy/);
  expect(titlebarColor).not.toBe(await panel.evaluate((element) => getComputedStyle(element).backgroundColor));
});

test('macOS chrome respects normal and reduced-transparency preferences', async ({ window }) => {
  const platform = await window.evaluate(() => window.api.platform);
  if (platform !== 'darwin') test.skip();
  const session = await window.context().newCDPSession(window);
  const chromeColor = () => window.getByTestId('sidebar-titlebar').evaluate((element) => getComputedStyle(element).backgroundColor);
  try {
    for (const preference of ['no-preference', 'reduce']) {
      // Hosted macOS runners enable reduced transparency. Exercise both states
      // explicitly instead of treating an accessibility preference as a defect.
      await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: preference }] });
      await expect.poll(() => window.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)).toBe(preference === 'reduce');
      if (preference === 'no-preference') await expect.poll(chromeColor).toMatch(/\/\s*0\.44\)|rgba\([^)]*,\s*0\.44\)/);
      else await expect.poll(chromeColor).not.toMatch(/\/\s*0\.[0-9]+\)|rgba\([^)]*,\s*0\.[0-9]+\)/);
      const panelColor = await window.getByTestId('sidebar-panel-surface').evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(panelColor).not.toBe(await chromeColor());
      expect(panelColor).not.toMatch(/\/\s*0\.[0-9]+\)|rgba\([^)]*,\s*0\.[0-9]+\)/);
    }
  } finally { await session.detach(); }
});

test('sheet selector is plain text without a floating card background', async ({ window }) => {
  const selector = window.getByTestId('sidebar-sheet-selector');
  await expect(selector).toBeVisible();
  expect(await selector.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
});

test('sidebar collapses to its icon rail and remains fully navigable', async ({ window }) => {
  const sidebar = window.getByTestId('sidebar');
  const rail = window.getByTestId('sidebar-rail');
  const expandedBox = await sidebar.boundingBox();
  const railBox = await rail.boundingBox();

  expect(expandedBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  if (!expandedBox || !railBox) throw new Error('Expected visible sidebar geometry');
  expect(expandedBox.width).toBe(240);
  expect(railBox.width).toBe(56);

  await window.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(56);
  await expect(window.getByRole('link', { name: 'Transactions' })).toBeVisible();

  await window.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(240);
});

// The default-sheet creation on first run is covered by transactions.e2e.ts rather
// than here: saving a transaction only succeeds if the sheet it names exists, since
// `assertSheetsExist` rejects it otherwise. That is a stronger check than reading
// the sheet picker, and it does not depend on how the picker is built.
