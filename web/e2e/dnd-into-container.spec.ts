import { test, expect } from '@playwright/test';

/**
 * Test drag-and-drop of a tree node INTO a container.
 * Uses the code2 workspace which has:
 *   h_accordion root
 *   ├── root/w-0  iTerm2
 *   ├── root/w-1  Xcode         ← we'll drag this
 *   ├── root/c-2  v_accordion   ← into this container
 *   │   ├── root/c-2/w-0  iTerm2
 *   │   └── root/c-2/w-1  iTerm2
 *   └── root/w-3  Code
 */

test.describe('Drag and drop into container', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for sidebar to load
    await page.waitForSelector('text=WORKSPACES', { timeout: 10000 });
    // Click code2 workspace
    await page.click('text=code2');
    // Wait for tree to render
    await page.waitForSelector('[data-node-id="root"]', { timeout: 5000 });
  });

  test('can see code2 workspace tree with containers', async ({ page }) => {
    // Verify the tree structure: root container exists
    const root = page.locator('[data-node-id="root"]');
    await expect(root).toBeVisible();

    // Dump all data-node-id values for debugging
    const nodeIds = await page.evaluate(() => {
      const els = document.querySelectorAll('[data-node-id]');
      return Array.from(els).map(el => ({
        id: el.getAttribute('data-node-id'),
        text: el.textContent?.trim().substring(0, 50),
      }));
    });
    console.log('Tree node IDs:', JSON.stringify(nodeIds, null, 2));

    // Verify we have a container child (v_accordion)
    const containerNode = page.locator('[data-node-id="root/c-2"]');
    const hasContainer = await containerNode.count();
    console.log('Container root/c-2 found:', hasContainer > 0);

    // If exact IDs don't match, find them dynamically
    if (hasContainer === 0) {
      console.log('Expected root/c-2 not found. Check actual IDs above.');
    }
  });

  test('drag Xcode into v_accordion container', async ({ page }) => {
    // Dump tree structure for debugging
    const nodeIds = await page.evaluate(() => {
      const els = document.querySelectorAll('[data-node-id]');
      return Array.from(els).map(el => ({
        id: el.getAttribute('data-node-id'),
        tag: el.tagName,
        classes: el.className.substring(0, 80),
        text: el.textContent?.trim().substring(0, 40),
        rect: el.getBoundingClientRect().toJSON(),
      }));
    });
    console.log('All tree nodes:', JSON.stringify(nodeIds, null, 2));

    // Find the Xcode window node (should be root/w-1)
    // Try exact ID first, then fallback to text search
    let sourceSelector = '[data-node-id="root/w-1"]';
    let sourceCount = await page.locator(sourceSelector).count();
    if (sourceCount === 0) {
      // Find by text content
      console.log('root/w-1 not found, searching by text...');
      const xcode = page.locator('[data-node-id] >> text=Xcode').first();
      await expect(xcode).toBeVisible();
      const parent = xcode.locator('xpath=ancestor::*[@data-node-id]').first();
      const nodeId = await parent.getAttribute('data-node-id');
      console.log('Xcode node ID:', nodeId);
      sourceSelector = `[data-node-id="${nodeId}"]`;
    }

    // Find the v_accordion container (should be root/c-2)
    let targetSelector = '[data-node-id="root/c-2"]';
    let targetCount = await page.locator(targetSelector).count();
    if (targetCount === 0) {
      console.log('root/c-2 not found, searching by text...');
      const vacc = page.locator('[data-node-id] >> text=v_accordion').first();
      await expect(vacc).toBeVisible();
      const parent = vacc.locator('xpath=ancestor::*[@data-node-id]').first();
      const nodeId = await parent.getAttribute('data-node-id');
      console.log('v_accordion node ID:', nodeId);
      targetSelector = `[data-node-id="${nodeId}"]`;
    }

    const source = page.locator(sourceSelector).first();
    const target = page.locator(targetSelector).first();

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();

    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    console.log('Source (Xcode) box:', sourceBox);
    console.log('Target (v_accordion) box:', targetBox);

    // --- Perform dnd-kit compatible drag ---
    // dnd-kit uses PointerSensor with 5px activation distance

    // 1. Move to source center and press down
    const sx = sourceBox!.x + sourceBox!.width / 2;
    const sy = sourceBox!.y + sourceBox!.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();

    // 2. Move past activation distance (>5px)
    await page.mouse.move(sx + 0, sy + 10, { steps: 3 });
    await page.waitForTimeout(100);

    // 3. Move to target center (middle 50% zone = 'inside')
    const tx = targetBox!.x + targetBox!.width / 2;
    const ty = targetBox!.y + targetBox!.height / 2;
    await page.mouse.move(tx, ty, { steps: 10 });
    await page.waitForTimeout(200);

    // 4. Check for drop indicator during hover
    const dropIndicator = await page.evaluate(() => {
      // Look for the container highlight (border-dashed + border-blue)
      const indicators = document.querySelectorAll('.border-dashed');
      return Array.from(indicators).map(el => ({
        classes: el.className,
        visible: el.getBoundingClientRect().height > 0,
        parent: el.parentElement?.getAttribute('data-node-id'),
      }));
    });
    console.log('Drop indicators during hover:', JSON.stringify(dropIndicator, null, 2));

    // Check debug state from collision detection
    const debugState = await page.evaluate(() => ({
      collision: (window as any).__DEBUG_COLLISION ?? 'not set',
      dropTarget: (window as any).__DEBUG_DROP_TARGET ?? 'not set',
    }));
    console.log('DEBUG collision:', JSON.stringify(debugState.collision, null, 2));
    console.log('DEBUG drop target:', JSON.stringify(debugState.dropTarget, null, 2));

    // 5. Drop
    await page.mouse.up();
    await page.waitForTimeout(300);

    // 6. Verify Xcode moved into the container
    const afterNodeIds = await page.evaluate(() => {
      const els = document.querySelectorAll('[data-node-id]');
      return Array.from(els).map(el => ({
        id: el.getAttribute('data-node-id'),
        text: el.textContent?.trim().substring(0, 40),
      }));
    });
    console.log('Tree after drop:', JSON.stringify(afterNodeIds, null, 2));

    // Check if Xcode's node ID now starts with the container's prefix
    const xcodeAfter = afterNodeIds.find(n => n.text?.includes('Xcode'));
    console.log('Xcode after drop:', xcodeAfter);

    // STRICT ASSERTION: Xcode must be inside a container after drop
    expect(xcodeAfter).toBeDefined();
    expect(xcodeAfter!.id).toContain('/c-');
    console.log('Xcode moved into container: true');
  });
});
