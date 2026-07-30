'use client';
'use react';

import { useState } from 'react';

export function ReactEscapeCounter() {
	const [count, setCount] = useState(20);
	return (
		<section className="card react-card" data-react-component="true" data-count={count}>
			<p className="eyebrow">React escape hatch</p>
			<h2>Explicit React ownership</h2>
			<p className="counter-label">React count: {count}</p>
			<div className="counter-actions">
				<button onClick={() => setCount((value) => value + 1)}>Increase React</button>
			</div>
		</section>
	);
}
