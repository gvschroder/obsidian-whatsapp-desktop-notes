// Short, stable identifiers. Pure.

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

/**
 * 32-bit FNV-1a over the string's UTF-16 code units, printed in base 36.
 * Gives stable short labels ("Member-1uyzqlg" for an unknown @lid sender).
 * Not a security primitive: only stability and few collisions matter.
 */
export function fnv1aBase36(input: string): string {
	let hash = FNV_OFFSET_BASIS;
	for (const unit of Array.from({ length: input.length }, (_, i) => input.charCodeAt(i))) {
		hash = Math.imul(hash ^ unit, FNV_PRIME);
	}
	return (hash >>> 0).toString(36);
}
