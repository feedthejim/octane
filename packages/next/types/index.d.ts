import type { NextConfig } from 'next';

export interface NextConfigContext<TConfig extends object = NextConfig> {
	defaultConfig: TConfig;
}

export type NextConfigFunction<
	TDefaultConfig extends object = NextConfig,
	TResolvedConfig extends object = NextConfig,
> = (
	phase: string,
	context: NextConfigContext<TDefaultConfig>,
) => TResolvedConfig | Promise<TResolvedConfig>;

export type OctaneNextConfig<TConfig extends object = NextConfig> = Omit<TConfig, 'turbopack'> &
	Pick<NextConfig, 'turbopack'>;

export type OctaneNextConfigFunction<
	TDefaultConfig extends object = NextConfig,
	TResolvedConfig extends object = NextConfig,
> = (
	phase: string,
	context: NextConfigContext<TDefaultConfig>,
) => OctaneNextConfig<TResolvedConfig> | Promise<OctaneNextConfig<TResolvedConfig>>;

export interface OctaneNextOptions {
	/**
	 * `"all"` considers every `.tsx` `"use client"` boundary and keeps
	 * incompatible boundaries on React. `"directive"` compiles only modules
	 * marked with `"use octane"`.
	 */
	clientComponents?: 'directive' | 'all';
	/** Emit a warning for each automatic boundary that remains on React. */
	diagnostics?: boolean;
	/** Emit Octane client profiling metadata. */
	profile?: boolean;
	/** Project root used to canonicalize compiler module IDs. Defaults to `process.cwd()`. */
	root?: string;
	/**
	 * Keep Next's React-owned Flight and App Router runtime while Octane owns
	 * application island descendants.
	 */
	runtime?: 'hybrid';
}

export declare function createOctanePlugin(options?: OctaneNextOptions): {
	<TDefaultConfig extends object, TResolvedConfig extends object>(
		nextConfig: NextConfigFunction<TDefaultConfig, TResolvedConfig>,
	): OctaneNextConfigFunction<TDefaultConfig, TResolvedConfig>;
	<TConfig extends object = NextConfig>(nextConfig?: TConfig): OctaneNextConfig<TConfig>;
};

export declare function withOctane<TDefaultConfig extends object, TResolvedConfig extends object>(
	nextConfig: NextConfigFunction<TDefaultConfig, TResolvedConfig>,
): OctaneNextConfigFunction<TDefaultConfig, TResolvedConfig>;
export declare function withOctane<TConfig extends object = NextConfig>(
	nextConfig?: TConfig,
): OctaneNextConfig<TConfig>;
