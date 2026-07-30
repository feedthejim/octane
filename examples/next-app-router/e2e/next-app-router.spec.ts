import { readFile } from 'node:fs/promises';
import { test, expect } from './test.ts';

test.describe('Next App Router hosting an Octane client boundary', () => {
	test('app-router-cache-hydration: streams the shell and adopts live Octane state', async ({
		page,
	}) => {
		const prerenderManifest = JSON.parse(
			await readFile(new URL('../.next/prerender-manifest.json', import.meta.url), 'utf8'),
		) as {
			routes: Record<string, { experimentalPPR?: boolean; renderingMode?: string }>;
		};
		expect(prerenderManifest.routes['/']).toMatchObject({
			experimentalPPR: true,
			renderingMode: 'PARTIALLY_STATIC',
		});

		const response = await page.request.get('/');
		expect(response.ok()).toBe(true);
		const serverHtml = await response.text();
		expect(serverHtml).toContain('data-cache-component="true"');
		expect(serverHtml).toContain('data-octane-component="true"');

		await page.addInitScript(() => {
			let observer: MutationObserver | undefined;
			const markServerIsland = () => {
				const node = document.querySelector('[data-octane-component="true"]');
				if (node === null) return;
				(node as HTMLElement & { __octaneIdentity?: string }).__octaneIdentity = 'server-node';
				observer?.disconnect();
			};
			observer = new MutationObserver(markServerIsland);
			observer.observe(document, { childList: true, subtree: true });
			markServerIsland();
		});
		await page.goto('/', { waitUntil: 'domcontentloaded' });

		await expect(page.locator('[data-cache-component="true"]')).toBeVisible();
		await expect(page.locator('[data-request-content="true"]')).toBeVisible();

		const island = page.locator('[data-octane-component="true"]');
		await expect(island).toHaveAttribute('data-count', '2');
		await expect(island).toHaveAttribute('data-parity', 'even');
		await expect(island.locator('.counter-label')).toHaveText('Octane count: 2');
		await expect
			.poll(() => page.evaluate(() => document.documentElement.dataset.octaneCounter))
			.toBe('2');
		expect(
			await island.evaluate(
				(node) => (node as HTMLElement & { __octaneIdentity?: string }).__octaneIdentity,
			),
		).toBe('server-node');
		await island.getByRole('button', { name: 'Increase', exact: true }).click();

		await expect(island).toHaveAttribute('data-count', '3');
		await expect(island).toHaveAttribute('data-parity', 'odd');
		await expect(island.locator('.counter-label')).toHaveText('Octane count: 3');
		expect(
			await island.evaluate(
				(node) => (node as HTMLElement & { __octaneIdentity?: string }).__octaneIdentity,
			),
		).toBe('server-node');

		const migratedIsland = page.locator('[data-migrated-component="true"]');
		await expect(migratedIsland).toHaveAttribute('data-count', '10');
		await expect(migratedIsland.locator('[data-imported-react-child="true"]')).toHaveText(
			'Imported child: 20',
		);
		await expect
			.poll(() => page.evaluate(() => document.documentElement.dataset.migratedReactCounter))
			.toBe('10');
		await migratedIsland.getByRole('button', { name: 'Increase migrated' }).click();
		await expect(migratedIsland).toHaveAttribute('data-count', '11');
		await expect(migratedIsland.locator('[data-imported-react-child="true"]')).toHaveText(
			'Imported child: 22',
		);
		await expect
			.poll(() => page.evaluate(() => document.documentElement.dataset.migratedReactCounter))
			.toBe('11');

		const reactIsland = page.locator('[data-react-component="true"]');
		await expect(reactIsland).toHaveAttribute('data-count', '20');
		await reactIsland.getByRole('button', { name: 'Increase React' }).click();
		await expect(reactIsland).toHaveAttribute('data-count', '21');
	});
});
