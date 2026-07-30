'use octane';

import { useMemo } from 'react';

export function ReactImportedChild({ count }: { count: number }) {
	const doubled = useMemo(() => count * 2, [count]);
	return <p data-imported-react-child="true">Imported child: {doubled}</p>;
}
