import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { resolveExampleServerAddress } from '../../_shared/e2e/server.ts';

const exampleRoot = fileURLToPath(new URL('..', import.meta.url));
const address = await resolveExampleServerAddress({
	baseURLEnv: 'NEXT_OCTANE_EXAMPLE_BASE_URL',
	portEnv: 'NEXT_OCTANE_EXAMPLE_PORT',
	persistAllocatedPort: true,
});

export default defineConfig({
	testDir: '.',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: 'list',

	projects: [
		{
			name: 'next-app-router',
			use: {
				...devices['Desktop Chrome'],
				baseURL: address.baseURL,
			},
		},
	],

	webServer: address.external
		? undefined
		: [
				{
					command: `pnpm build && pnpm exec next start --port ${address.port}`,
					url: address.baseURL,
					cwd: exampleRoot,
					reuseExistingServer: false,
					timeout: 120_000,
				},
			],
});
