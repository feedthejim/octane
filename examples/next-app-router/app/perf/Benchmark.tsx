'use client';

import {
	createContext,
	memo,
	useContext,
	useEffect,
	useState,
	type Dispatch,
	type SetStateAction,
} from 'react';
import { flushSync } from 'react-dom';

const ROW_COUNT = 1000;
const MIDDLE_ROW = ROW_COUNT >> 1;
const Theme = createContext('t0');
const selectRow = () => {};

interface Item {
	id: number;
	label: string;
	value: number;
}

interface RenderCounts {
	inner: number;
	leaf: number;
	row: number;
}

interface BenchmarkApi {
	context(): void;
	oneChange(): void;
	parent(): void;
	read(): {
		middleValue: string | null;
		renders: RenderCounts;
		rows: number;
		theme: string | null;
	};
	resetRenders(): void;
}

declare global {
	interface Window {
		__nextClientBenchmark?: BenchmarkApi;
		__nextClientRenders?: RenderCounts;
	}
}

function makeItems(): Item[] {
	return Array.from({ length: ROW_COUNT }, (_, index) => ({
		id: index + 1,
		label: `row ${index + 1}`,
		value: index * 17,
	}));
}

function renders(): RenderCounts | null {
	if (typeof window === 'undefined') return null;
	return (window.__nextClientRenders ??= { inner: 0, leaf: 0, row: 0 });
}

function resetRenders() {
	window.__nextClientRenders = { inner: 0, leaf: 0, row: 0 };
}

function Leaf() {
	const counts = renders();
	if (counts !== null) counts.leaf += 1;
	const theme = useContext(Theme);
	return <span className="leaf">{theme}</span>;
}

function InnerImpl({ value }: { value: number }) {
	const counts = renders();
	if (counts !== null) counts.inner += 1;
	return (
		<span className="inner">
			{value}
			<Leaf />
		</span>
	);
}

const Inner = memo(InnerImpl);

function RowImpl({ id, label, value }: Item) {
	const counts = renders();
	if (counts !== null) counts.row += 1;
	return (
		<div className="item">
			<button type="button" onClick={selectRow}>
				{id}
			</button>
			<span>{label}</span>
			<Inner value={value} />
		</div>
	);
}

const Row = memo(RowImpl);

function Rows({ items }: { items: Item[] }) {
	return (
		<div className="rows">
			{items.map((item) => (
				<Row key={item.id} id={item.id} label={item.label} value={item.value} />
			))}
		</div>
	);
}

function readState(): ReturnType<BenchmarkApi['read']> {
	return {
		middleValue:
			document.querySelector(`.item:nth-child(${MIDDLE_ROW + 1}) .inner`)?.firstChild
				?.textContent ?? null,
		renders: { ...(window.__nextClientRenders ?? { inner: 0, leaf: 0, row: 0 }) },
		rows: document.querySelectorAll('.rows > .item').length,
		theme: document.querySelector('.rows > .item .leaf')?.textContent ?? null,
	};
}

function installBenchmarkApi(
	setItems: Dispatch<SetStateAction<Item[]>>,
	setTheme: Dispatch<SetStateAction<string>>,
	setTick: Dispatch<SetStateAction<number>>,
) {
	window.__nextClientBenchmark = {
		context() {
			flushSync(() => {
				setTheme((current) => `t${Number(current.slice(1)) + 1}`);
			});
		},
		oneChange() {
			flushSync(() => {
				setItems((current) => {
					const next = current.slice();
					const item = next[MIDDLE_ROW];
					next[MIDDLE_ROW] = { ...item, value: item.value + 1 };
					return next;
				});
			});
		},
		parent() {
			flushSync(() => {
				setTick((current) => current + 1);
			});
		},
		read: readState,
		resetRenders,
	};
}

export function Benchmark() {
	const [items, setItems] = useState(makeItems);
	const [theme, setTheme] = useState('t0');
	const [tick, setTick] = useState(0);

	useEffect(() => {
		installBenchmarkApi(setItems, setTheme, setTick);
		return () => {
			delete window.__nextClientBenchmark;
			delete window.__nextClientRenders;
		};
	}, []);

	return (
		<section data-next-client-benchmark="true">
			<h1>
				Next client runtime benchmark <span className="tick">{tick}</span>
			</h1>
			<Theme.Provider value={theme}>
				<Rows items={items} />
			</Theme.Provider>
		</section>
	);
}
