/** @jsxImportSource octane */
'use client';
'use octane';

import { useEffect, useId, useMemo, useState, useTransition } from 'octane';
import { CounterLabel } from './CounterLabel.tsrx';

export interface OctaneCounterProps {
	initialCount: number;
}

export function OctaneCounter(props: OctaneCounterProps) {
	const [count, setCount] = useState(props.initialCount);
	const [pending, startTransition] = useTransition();
	const id = useId();
	const parity = useMemo(() => (count % 2 === 0 ? 'even' : 'odd'), [count]);

	useEffect(() => {
		document.documentElement.dataset.octaneCounter = String(count);
		return () => {
			delete document.documentElement.dataset.octaneCounter;
		};
	}, [count]);

	return (
		<section
			class="card octane-card"
			data-octane-component="true"
			data-count={count}
			data-parity={parity}
			aria-labelledby={id}
		>
			<p class="eyebrow">{'Octane Client Component'}</p>
			<h2 id={id}>{'Compiled state and events'}</h2>
			<CounterLabel count={count} />
			<div class="counter-actions">
				<button onClick={() => setCount(count - 1)}>{'Decrease'}</button>
				<button
					onClick={() => {
						startTransition(() => setCount(count + 1));
					}}
				>
					{'Increase'}
				</button>
				<button onClick={() => setCount(props.initialCount)}>{'Reset'}</button>
			</div>
			{pending ? <p class="pending">{'Updating…'}</p> : null}
		</section>
	);
}
