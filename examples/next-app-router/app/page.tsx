import { Suspense } from 'react';
import { cacheLife, cacheTag } from 'next/cache';
import { connection } from 'next/server';
import { OctaneCounter } from './OctaneCounter';
import { ReactCounter } from './ReactCounter';
import { ReactEscapeCounter } from './ReactEscapeCounter';

async function CachedShellCard() {
	'use cache';
	cacheLife('minutes');
	cacheTag('octane-next-shell');
	return (
		<section className="card cached-card" data-cache-component="true">
			<p className="eyebrow">Cache Component</p>
			<h2>Server-owned cached shell</h2>
			<p>
				This subtree is cached and streamed by Next. Its interactive sibling is owned by Octane
				after hydration.
			</p>
		</section>
	);
}

async function RequestCard() {
	await connection();
	return (
		<section className="card request-card" data-request-content="true">
			<p className="eyebrow">Request-time stream</p>
			<h2>Dynamic content reached the shell</h2>
		</section>
	);
}

export default function Page() {
	return (
		<main>
			<header>
				<p className="eyebrow">Turbopack hybrid runtime</p>
				<h1>Next routes. Octane interacts.</h1>
				<p className="lede">
					React owns Flight and App Router. Octane owns the interactive descendants inside the
					generated client-reference facade.
				</p>
			</header>

			<div className="grid">
				<CachedShellCard />
				<OctaneCounter initialCount={2} />
				<ReactCounter />
				<ReactEscapeCounter />
				<Suspense
					fallback={
						<section className="card request-card" data-request-fallback="true">
							<p>Loading request-time content…</p>
						</section>
					}
				>
					<RequestCard />
				</Suspense>
			</div>
		</main>
	);
}
