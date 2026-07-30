'use client';

import { useEffect, useState } from 'react';
import { ReactImportedChild } from './ReactImportedChild';

export function ReactCounter() {
	const [count, setCount] = useState(10);

	useEffect(() => {
		document.documentElement.dataset.migratedReactCounter = String(count);
		return () => {
			delete document.documentElement.dataset.migratedReactCounter;
		};
	}, [count]);

	return (
		<section className="card migrated-card" data-migrated-component="true" data-count={count}>
			<p className="eyebrow">Automatic migration</p>
			<h2>React source, Octane runtime</h2>
			<p className="counter-label">Migrated count: {count}</p>
			<ReactImportedChild count={count} />
			<div className="counter-actions">
				<button onClick={() => setCount((value) => value + 1)}>Increase migrated</button>
			</div>
		</section>
	);
}
