/**
 * Drop target types for the custom collision detection system.
 * Used to communicate where a dragged node will land.
 */

export interface DropTarget {
  /** Where relative to the target node the drop will occur */
  type: 'before' | 'after' | 'inside';
  /** FlatNode ID of the target node */
  targetId: string;
}
