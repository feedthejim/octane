import { test as base, expect } from '@playwright/test';
import { collectBrowserDiagnostics, settleBrowserFrames } from '../../_shared/e2e/browser.ts';

export const test = base.extend<{ browserDiagnosticsGate: void }>({
	browserDiagnosticsGate: [
		async ({ page }, use, testInfo) => {
			const diagnostics = collectBrowserDiagnostics(page, {
				failOnHydrationWarnings: true,
			});
			try {
				await use();
				await settleBrowserFrames(page);
				diagnostics.assertClean(`${testInfo.project.name}: ${testInfo.title}`);
			} finally {
				diagnostics.stop();
			}
		},
		{ auto: true },
	],
});

export { expect };
