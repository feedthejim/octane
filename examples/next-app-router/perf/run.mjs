process.env.NODE_ENV = 'production';

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const directory = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.resolve(directory, '..');
const repoRoot = path.resolve(exampleRoot, '../..');
const port = 5310;
const url = `http://127.0.0.1:${port}/perf`;
const iterationArgument = process.argv.slice(2).find((argument) => /^\d+$/.test(argument));
const iterations = Number.parseInt(iterationArgument ?? '20', 10);
const warmups = 5;
const targetBatchMs = 8;
const maxRepetitions = 65_536;
const operations = [
	{
		name: 'equal_parent',
		expected: { inner: 0, leaf: 0, row: 0 },
	},
	{
		name: 'one_change',
		expected: { inner: 1, leaf: [0, 1], row: 1 },
	},
	{
		name: 'context_fanout',
		expected: { inner: 0, leaf: 1000, row: 0 },
	},
];

function runtimeEnv(runtime) {
	const env = {
		...process.env,
		NEXT_TELEMETRY_DISABLED: '1',
		NO_COLOR: '1',
		OCTANE_NEXT_BENCH_RUNTIME: runtime,
	};
	delete env.FORCE_COLOR;
	return env;
}

function run(command, args, options = {}) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd ?? exampleRoot,
			env: options.env ?? process.env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = '';
		child.stdout.on('data', (chunk) => {
			output += chunk;
			if (!options.quiet) process.stdout.write(chunk);
		});
		child.stderr.on('data', (chunk) => {
			output += chunk;
			if (!options.quiet) process.stderr.write(chunk);
		});
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code !== 0) {
				reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}\n${output}`));
				return;
			}
			resolvePromise(output);
		});
	});
}

async function waitForServer(server) {
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		if (server.exitCode !== null) {
			throw new Error(`Next server exited before readiness: ${server.exitCode}`);
		}
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
	}
	throw new Error('Timed out waiting for the Next benchmark server');
}

async function stopServer(server) {
	if (server.exitCode !== null) return;
	server.kill('SIGTERM');
	await Promise.race([
		new Promise((resolvePromise) => server.once('exit', resolvePromise)),
		new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
	]);
	if (server.exitCode === null) server.kill('SIGKILL');
}

function summarize(samples) {
	const sorted = [...samples].sort((a, b) => a - b);
	return {
		median: sorted[Math.floor(sorted.length / 2)],
		min: sorted[0],
		p90: sorted[Math.ceil(sorted.length * 0.9) - 1],
		samples: sorted.length,
	};
}

async function freshPage(browser) {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(url, { waitUntil: 'load' });
	await page.waitForFunction(() => window.__nextClientBenchmark !== undefined);
	return { context, page };
}

async function measureOperation(browser, operation) {
	const { context, page } = await freshPage(browser);
	const result = await page.evaluate(
		async ({ iterations, maxRepetitions, name, targetBatchMs, warmups }) => {
			const api = window.__nextClientBenchmark;
			if (api === undefined) throw new Error('Benchmark API is missing');
			const operationName =
				name === 'equal_parent' ? 'parent' : name === 'one_change' ? 'oneChange' : 'context';
			const invoke = api[operationName];
			const runBatch = (count) => {
				const startedAt = performance.now();
				for (let index = 0; index < count; index += 1) invoke();
				return performance.now() - startedAt;
			};

			let repetitions = 1;
			while (repetitions < maxRepetitions) {
				const elapsed = runBatch(repetitions);
				if (elapsed >= targetBatchMs) break;
				const estimated =
					elapsed > 0 ? Math.ceil((repetitions * targetBatchMs) / elapsed) : repetitions * 10;
				repetitions = Math.min(maxRepetitions, Math.max(repetitions * 2, estimated));
			}

			const samples = [];
			for (let iteration = 0; iteration < warmups + iterations; iteration += 1) {
				window.gc?.();
				const duration = runBatch(repetitions) / repetitions;
				if (iteration >= warmups) samples.push(duration);
				await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
			}

			api.resetRenders();
			invoke();
			return {
				repetitions,
				samples,
				state: api.read(),
			};
		},
		{
			iterations,
			maxRepetitions,
			name: operation.name,
			targetBatchMs,
			warmups,
		},
	);
	await context.close();
	return result;
}

async function measureRuntime(runtime) {
	console.log(`\nBuilding ${runtime}...`);
	const output = await run('pnpm', ['exec', 'next', 'build', '--turbopack'], {
		env: runtimeEnv(runtime),
	});
	const compile = output.match(/Compiled successfully in ([\d.]+)(ms|s)/);
	const compileMs = compile === null ? null : Number(compile[1]) * (compile[2] === 's' ? 1000 : 1);
	const server = spawn('pnpm', ['exec', 'next', 'start', '--port', String(port)], {
		cwd: exampleRoot,
		env: runtimeEnv(runtime),
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	server.stdout.on('data', (chunk) => process.stdout.write(chunk));
	server.stderr.on('data', (chunk) => process.stderr.write(chunk));
	await waitForServer(server);
	const browser = await chromium.launch({
		headless: true,
		args: ['--no-sandbox', '--js-flags=--expose-gc'],
	});
	const results = {};

	try {
		for (const operation of operations) {
			console.log(`  measuring ${operation.name}`);
			const measured = await measureOperation(browser, operation);
			const expected = operation.expected;
			const state = measured.state;
			const matches = (actual, wanted) =>
				Array.isArray(wanted) ? wanted.includes(actual) : actual === wanted;
			if (
				state.rows !== 1000 ||
				!matches(state.renders.inner, expected.inner) ||
				!matches(state.renders.leaf, expected.leaf) ||
				!matches(state.renders.row, expected.row)
			) {
				throw new Error(
					`${runtime}.${operation.name} correctness failure: ${JSON.stringify(state)}`,
				);
			}
			results[operation.name] = {
				...summarize(measured.samples),
				repetitions: measured.repetitions,
			};
		}
	} finally {
		await browser.close();
		await stopServer(server);
	}

	return { compileMs, operations: results };
}

if (!Number.isFinite(iterations) || iterations < 1) {
	throw new Error('Iteration count must be a positive integer');
}

await run('pnpm', ['--filter', 'octane', 'build'], { cwd: repoRoot });
const react = await measureRuntime('react');
const octane = await measureRuntime('octane');
const payload = {
	suite: 'next-client-runtime',
	iterations,
	targets: [
		{ name: 'react', ops: react.operations, meta: { compileMs: react.compileMs } },
		{ name: 'octane', ops: octane.operations, meta: { compileMs: octane.compileMs } },
	],
};

console.log('\nNext App Router client-runtime comparison');
for (const operation of operations) {
	const baseline = react.operations[operation.name].median;
	const candidate = octane.operations[operation.name].median;
	console.log(
		`  ${operation.name}: React ${baseline.toFixed(4)} ms, Octane ${candidate.toFixed(4)} ms (${(candidate / baseline).toFixed(2)}x)`,
	);
}

if (process.env.BENCH_JSON) {
	fs.writeFileSync(process.env.BENCH_JSON, `${JSON.stringify(payload, null, '\t')}\n`);
	console.log(`Wrote ${process.env.BENCH_JSON}`);
}
