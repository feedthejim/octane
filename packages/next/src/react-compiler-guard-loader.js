const OPT_OUT_DIRECTIVE = `'use no memo';`;

export default function reactCompilerGuardLoader(source, inputSourceMap) {
	this.cacheable?.(true);
	const text = String(source);
	const guarded = text.startsWith(OPT_OUT_DIRECTIVE) ? text : `${OPT_OUT_DIRECTIVE}${text}`;
	this.callback(null, guarded, this.sourceMap === false ? undefined : inputSourceMap);
}
