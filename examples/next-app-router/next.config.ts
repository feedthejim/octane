import { createOctanePlugin, withOctane } from '@octanejs/next';

const reactBenchmark = process.env.OCTANE_NEXT_BENCH_RUNTIME === 'react';
const nextConfig = {
	cacheComponents: true,
	...(reactBenchmark ? { reactCompiler: true } : {}),
};

export default reactBenchmark
	? createOctanePlugin({ clientComponents: 'directive' })(nextConfig)
	: withOctane(nextConfig);
