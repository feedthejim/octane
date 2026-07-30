import React from 'react';
import { OctaneCompat as HostedOctaneCompat } from 'octane/react/server';

function serializableProps(props) {
	const seen = new WeakSet();
	try {
		return JSON.stringify(props, (_key, value) => {
			if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
				throw new TypeError('non-serializable Octane boundary props');
			}
			if (value !== null && typeof value === 'object') {
				if (seen.has(value)) throw new TypeError('cyclic Octane boundary props');
				seen.add(value);
			}
			return value;
		});
	} catch {
		return null;
	}
}

export function registerOctaneBoundary() {}

export function OctaneCompat({ __octaneNativeId, ...props }) {
	const hosted = React.createElement(HostedOctaneCompat, props);
	if (__octaneNativeId === undefined) return hosted;
	const encodedProps = serializableProps(props.props ?? {});
	return React.createElement(
		'span',
		{
			'data-octane-native': __octaneNativeId,
			...(encodedProps === null ? null : { 'data-octane-props': encodedProps }),
			style: { display: 'contents' },
			suppressHydrationWarning: true,
		},
		hosted,
	);
}
