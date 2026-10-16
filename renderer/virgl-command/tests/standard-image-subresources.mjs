/** Original packets execute only in this explicit host-selected proof. */
export {runWireAcceptance} from './standard-image-boundaries.mjs';
import {runAcceptance as matrix} from './standard-image-matrix.mjs';
import {runAcceptance as boundaries} from './standard-image-boundaries.mjs';
export async function runAcceptance(options={}) {
 return options.fault || options.mode==='boundaries' ? boundaries(options) : matrix(options);
}
