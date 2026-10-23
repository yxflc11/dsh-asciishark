/**
 * Host half of the ASCII-ocean background plugin.
 *
 * The browser half ships through `exports["./client"]`; this empty `apply`
 * gives the Cordis Loader a host-side row without adding any host behavior.
 */
export function apply() {}
