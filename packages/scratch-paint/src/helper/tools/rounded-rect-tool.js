import paper from '@turbowarp/paper';
import Modes from '../../lib/modes';
import { styleShape } from '../style-path';
import { clearSelection, getSelectedRootItems } from '../selection';
import { getSquareDimensions } from '../math';
import BoundingBoxTool from '../selection-tools/bounding-box-tool';
import NudgeTool from '../selection-tools/nudge-tool';

/**
 * Tool for drawing rounded rectangles.
 */
class RoundedRectTool extends paper.Tool {
  static get TOLERANCE() {
    return 2;
  }
  /**
   * @param {function} setHoveredItem Callback to set the hovered item
   * @param {function} clearHoveredItem Callback to clear the hovered item
   * @param {function} setSelectedItems Callback to set the set of selected items in the Redux state
   * @param {function} clearSelectedItems Callback to clear the set of selected items in the Redux state
   * @param {function} setCursor Callback to set the visible mouse cursor
   * @param {!function} onUpdateImage A callback to call when the image visibly changes
   */
  constructor(setHoveredItem, clearHoveredItem, setSelectedItems, clearSelectedItems, setCursor, onUpdateImage) {
    super();
    this.setHoveredItem = setHoveredItem;
    this.clearHoveredItem = clearHoveredItem;
    this.setSelectedItems = setSelectedItems;
    this.clearSelectedItems = clearSelectedItems;
    this.onUpdateImage = onUpdateImage;
    this.prevHoveredItemId = null;

    // Initialize bounding box tool for editing existing shapes
    this.boundingBoxTool = new BoundingBoxTool(
      Modes.ROUNDED_RECT,
      setSelectedItems,
      clearSelectedItems,
      setCursor,
      onUpdateImage
    );
    const nudgeTool = new NudgeTool(Modes.ROUNDED_RECT, this.boundingBoxTool, onUpdateImage);

    // We have to set these functions instead of just declaring them because
    // paper.js tools hook up the listeners in the setter functions.
    this.onMouseDown = this.handleMouseDown;
    this.onMouseMove = this.handleMouseMove;
    this.onMouseDrag = this.handleMouseDrag;
    this.onMouseUp = this.handleMouseUp;
    this.onKeyUp = nudgeTool.onKeyUp;
    this.onKeyDown = nudgeTool.onKeyDown;

    this.rect = null;
    this.colorState = null;
    this.cornerRadius = 10;
    this.proportional = false;
    this.isBoundingBoxMode = null;
    this.active = false;
  }

  getHitOptions() {
    return {
      segments: true,
      stroke: true,
      curves: true,
      fill: true,
      guide: false,
      match: (hitResult) =>
        (hitResult.item.data && (hitResult.item.data.isScaleHandle || hitResult.item.data.isRotHandle)) ||
        hitResult.item.selected,
      tolerance: RoundedRectTool.TOLERANCE / paper.view.zoom
    };
  }

  /**
   * Should be called if the selection changes to update the bounds of the bounding box.
   * @param {Array<paper.Item>} selectedItems Array of selected items.
   */
  onSelectionChanged(selectedItems) {
    this.boundingBoxTool.onSelectionChanged(selectedItems);
  }

  setColorState(colorState) {
    this.colorState = colorState;
  }

  setCornerRadius(cornerRadius) {
    this.cornerRadius = cornerRadius;

    // If any rounded rects are selected, update them in place
    const selected = getSelectedRootItems();
    if (!selected || !selected.length) return;

    let updated = false;
    for (const item of selected) {
      if (item.data && item.data.isRoundedRect) {
        this._updateItemCornerRadius(item, cornerRadius);
        updated = true;
      }
    }
    if (updated) {
      this.setSelectedItems();
      this.onUpdateImage();
    }
  }

  _updateItemCornerRadius(item, newRadius) {
    const origW = item.data.origWidth || item.bounds.width;
    const origH = item.data.origHeight || item.bounds.height;
    const rect = new paper.Rectangle(0, 0, origW, origH);
    const newPath = new paper.Path.Rectangle(rect, newRadius);

    // Copy style
    newPath.fillColor = item.fillColor;
    newPath.strokeColor = item.strokeColor;
    newPath.strokeWidth = item.strokeWidth;
    newPath.strokeCap = item.strokeCap;
    newPath.strokeJoin = item.strokeJoin;
    newPath.dashArray = item.dashArray;

    // Restore position and rotation — set position first so rotation
    // is applied around the correct center
    newPath.position = item.position;
    newPath.rotation = item.rotation;
    newPath.scaling = item.scaling;

    newPath.data = {
      isRoundedRect: true,
      cornerRadius: newRadius,
      origWidth: origW,
      origHeight: origH
    };

    // Replace in layer
    const parent = item.parent;
    const idx = parent.children.indexOf(item);
    item.remove();
    parent.insertChild(idx, newPath);
    newPath.selected = true;
  }

  setProportional(proportional) {
    this.proportional = proportional;
  }

  /**
   * To be called when the hovered item changes.
   * @param {paper.Item} prevHoveredItemId ID of the highlight item
   */
  setPrevHoveredItemId(prevHoveredItemId) {
    this.prevHoveredItemId = prevHoveredItemId;
  }

  handleMouseDown(event) {
    if (event.event.button > 0) return; // only first mouse button
    this.active = true;

    if (this.boundingBoxTool.onMouseDown(event, false, false, false, this.getHitOptions())) {
      this.isBoundingBoxMode = true;
    } else {
      this.isBoundingBoxMode = false;
      clearSelection(this.clearSelectedItems);
    }
  }

  handleMouseDrag(event) {
    if (event.event.button > 0 || !this.active) return;

    if (this.isBoundingBoxMode) {
      this.boundingBoxTool.onMouseDrag(event);
      return;
    }

    if (this.rect) {
      this.rect.remove();
    }

    const rect = new paper.Rectangle(event.downPoint, event.point);
    const squareDimensions = getSquareDimensions(event.downPoint, event.point);

    const isProportional = event.modifiers.shift || this.proportional;
    if (isProportional) {
      rect.size = squareDimensions.size.abs();
    }

    // Create rounded rectangle with fixed corner radius
    this.rect = new paper.Path.Rectangle(rect, this.cornerRadius);
    this.rect.data = {
      isRoundedRect: true,
      cornerRadius: this.cornerRadius,
      origWidth: rect.width,
      origHeight: rect.height
    };

    if (event.modifiers.alt) {
      this.rect.position = event.downPoint;
    } else if (isProportional) {
      this.rect.position = squareDimensions.position;
    } else {
      const dimensions = event.point.subtract(event.downPoint);
      this.rect.position = event.downPoint.add(dimensions.multiply(0.5));
    }

    styleShape(this.rect, this.colorState);
  }

  handleMouseUp(event) {
    if (event.event.button > 0 || !this.active) return;

    if (this.isBoundingBoxMode) {
      this.boundingBoxTool.onMouseUp(event);
      this.isBoundingBoxMode = null;
      return;
    }

    if (this.rect) {
      if (this.rect.area < RoundedRectTool.TOLERANCE / paper.view.zoom) {
        // Tiny rectangle created unintentionally?
        this.rect.remove();
        this.rect = null;
      } else {
        this.rect.selected = true;
        this.setSelectedItems();
        this.onUpdateImage();
        this.rect = null;
      }
    }
    this.active = false;
  }

  handleMouseMove(event) {
    this.boundingBoxTool.onMouseMove(event, this.getHitOptions());
  }

  deactivateTool() {
    this.boundingBoxTool.deactivateTool();
    if (this.rect) {
      this.rect.remove();
      this.rect = null;
    }
  }
}

export default RoundedRectTool;
