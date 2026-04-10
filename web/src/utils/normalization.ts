/**
 * AeroSpace tree normalization utilities.
 *
 * AeroSpace enforces two normalization rules:
 * 1. Nested containers MUST have opposite orientations. If a horizontal container
 *    contains another horizontal container, AeroSpace auto-flips the inner one.
 * 2. Single-child containers are flattened into their parent (root exempt).
 *
 * These utilities help the web UI enforce rule #1 proactively, so users cannot
 * create same-orientation nested containers.
 */

import type { LayoutType, Orientation, TreeNode } from '../types';

/** Extract orientation from a layout type string. */
export function getOrientation(layout: LayoutType): Orientation {
  return layout.startsWith('h_') ? 'horizontal' : 'vertical';
}

/** Get the opposite orientation. */
export function oppositeOrientation(orientation: Orientation): Orientation {
  return orientation === 'horizontal' ? 'vertical' : 'horizontal';
}

/** Flip a layout type's orientation prefix (h_ <-> v_), preserving the style (accordion/tiles). */
export function flipLayout(layout: LayoutType): LayoutType {
  if (layout.startsWith('h_')) {
    return `v_${layout.slice(2)}` as LayoutType;
  }
  return `h_${layout.slice(2)}` as LayoutType;
}

/**
 * Given a parent container's layout, return the layout types that are allowed
 * for a child container (i.e., those with the opposite orientation).
 */
export function getAllowedChildLayouts(parentLayout: LayoutType): LayoutType[] {
  const parentOrientation = getOrientation(parentLayout);
  const ALL_LAYOUTS: LayoutType[] = ['h_accordion', 'v_accordion', 'h_tiles', 'v_tiles'];
  return ALL_LAYOUTS.filter((l) => getOrientation(l) !== parentOrientation);
}

/**
 * Given a parent container's layout, return the default layout for a new child container.
 * Uses the opposite orientation with the same style (accordion/tiles) as the parent.
 */
export function getDefaultChildLayout(parentLayout: LayoutType): LayoutType {
  return flipLayout(parentLayout);
}

/**
 * Check whether a given layout would violate the same-orientation rule
 * when placed inside a parent with the given layout.
 */
export function wouldViolateSameOrientation(
  parentLayout: LayoutType,
  childLayout: LayoutType,
): boolean {
  return getOrientation(parentLayout) === getOrientation(childLayout);
}

/**
 * Auto-fix a child container's layout to enforce opposite-orientation nesting.
 * If the child's layout has the same orientation as the parent, flip it.
 * Returns the (possibly corrected) layout.
 */
export function enforceOppositeOrientation(
  parentLayout: LayoutType,
  childLayout: LayoutType,
): LayoutType {
  if (wouldViolateSameOrientation(parentLayout, childLayout)) {
    return flipLayout(childLayout);
  }
  return childLayout;
}

/**
 * Check if a layout change on a container would create same-orientation
 * violations with any of its child containers. Returns the list of
 * child indices that would violate.
 */
export function findChildViolations(
  newParentLayout: LayoutType,
  children: TreeNode[],
): number[] {
  const violations: number[] = [];
  const parentOrientation = getOrientation(newParentLayout);

  children.forEach((child, index) => {
    if (child.type === 'container') {
      if (getOrientation(child.layout) === parentOrientation) {
        violations.push(index);
      }
    }
  });

  return violations;
}

/**
 * Auto-fix all child containers that would violate same-orientation nesting
 * after a parent layout change. Returns a new children array with corrected layouts.
 */
export function fixChildViolations(
  newParentLayout: LayoutType,
  children: TreeNode[],
): TreeNode[] {
  const parentOrientation = getOrientation(newParentLayout);

  return children.map((child) => {
    if (child.type === 'container' && getOrientation(child.layout) === parentOrientation) {
      const fixedLayout = flipLayout(child.layout);
      return {
        ...child,
        layout: fixedLayout,
        orientation: getOrientation(fixedLayout),
      };
    }
    return child;
  });
}

/**
 * Check if changing a container's layout would create a same-orientation
 * violation with its parent. Returns true if the change would violate.
 */
export function wouldViolateWithParent(
  parentLayout: LayoutType | null,
  newChildLayout: LayoutType,
): boolean {
  if (!parentLayout) return false; // Root container has no parent
  return getOrientation(parentLayout) === getOrientation(newChildLayout);
}
