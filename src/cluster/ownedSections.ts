import type { ClusterSectionId } from '../aws/clusterInfo';

/**
 * Which Cluster-view sections *this* extension can render.
 *
 * Exactly one: Properties, Free by an explicit decision (M10 §3). The other
 * nine are read and rendered by RedLens Pro and arrive through
 * `ui.contributeClusterSections`; without it installed the base draws them as
 * padlocks that still say what they would show.
 *
 * Still a list rather than a derivation from `tiers.ts`, even though the two
 * now agree. The tier map answers "who is allowed to use it"; this answers
 * "whose source implements it". They were out of step for the whole of the
 * split, and deriving one from the other then would have padlocked nine
 * sections the base could still draw.
 */
export const BASE_RENDERED_SECTIONS: readonly ClusterSectionId[] = ['properties'];

/** The split has landed: the paid renderers no longer live in this package. */
export const SPLIT_IN_FLIGHT = false;
