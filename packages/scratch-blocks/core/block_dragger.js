/**
 * @license
 * Visual Blocks Editor
 *
 * Copyright 2017 Google Inc.
 * https://developers.google.com/blockly/
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Methods for dragging a block visually.
 * @author fenichel@google.com (Rachel Fenichel)
 */
'use strict';

goog.provide('Blockly.BlockDragger');

goog.require('Blockly.BlockAnimations');
goog.require('Blockly.Events.BlockMove');
goog.require('Blockly.Events.DragBlockOutside');
goog.require('Blockly.Events.EndBlockDrag');
goog.require('Blockly.InsertionMarkerManager');

goog.require('goog.math.Coordinate');
goog.require('goog.asserts');

/**
 * Class for a block dragger.  It moves blocks around the workspace when they
 * are being dragged by a mouse or touch.
 * @param {!Blockly.BlockSvg} block The block to drag.
 * @param {!Blockly.WorkspaceSvg} workspace The workspace to drag on.
 * @constructor
 */
Blockly.BlockDragger = function (block, workspace) {
  /**
   * The top block in the stack that is being dragged.
   * @type {!Blockly.BlockSvg}
   * @private
   */
  this.draggingBlock_ = block;
  /**
   * The workspace on which the block is being dragged.
   * @type {!Blockly.WorkspaceSvg}
   * @private
   */
  this.workspace_ = workspace;

  /**
   * Object that keeps track of connections on dragged blocks.
   * @type {!Blockly.InsertionMarkerManager}
   * @private
   */
  this.draggedConnectionManager_ = new Blockly.InsertionMarkerManager(this.draggingBlock_);

  /**
   * Which delete area the mouse pointer is over, if any.
   * One of {@link Blockly.DELETE_AREA_TRASH},
   * {@link Blockly.DELETE_AREA_TOOLBOX}, or {@link Blockly.DELETE_AREA_NONE}.
   * @type {?number}
   * @private
   */
  this.deleteArea_ = null;

  /**
   * Whether the block would be deleted if dropped immediately.
   * @type {boolean}
   * @private
   */
  this.wouldDeleteBlock_ = false;

  /**
   * Whether the currently dragged block is outside of the workspace. Keep
   * track so that we can fire events only when this changes.
   * @type {boolean}
   * @private
   */
  this.wasOutside_ = false;

  /**
   * The location of the top left corner of the dragging block at the beginning
   * of the drag in workspace coordinates.
   * @type {!goog.math.Coordinate}
   * @private
   */
  this.startXY_ = this.draggingBlock_.getRelativeToSurfaceXY();

  /**
   * A list of all of the icons (comment, warning, and mutator) that are
   * on this block and its descendants.  Moving an icon moves the bubble that
   * extends from it if that bubble is open.
   * @type {Array.<!Object>}
   * @private
   */
  this.dragIconData_ = Blockly.BlockDragger.initIconData_(block);
};

/**
 * Diagnostic switch: collect per-drag timing and print a summary when the drag ends.
 *
 * Logs one small object per drag; set to false to silence it. Kept in the shipped build
 * because the interesting number is impossible to get from a long-task observer -- when a
 * drag feels slow but reports no long tasks, that gap *is* the answer (script time is
 * small, the frame is lost in style / layout / paint), and it can only be confirmed by
 * timing both sides during a real drag.
 * @type {boolean}
 */
Blockly.BlockDragger.PERF = true;

/**
 * Timing being collected for the drag in progress, or null.
 * @type {?Object}
 * @private
 */
Blockly.BlockDragger.perf_ = null;

/**
 * Sever all links from this object.
 * @package
 */
Blockly.BlockDragger.prototype.dispose = function () {
  this.draggingBlock_ = null;
  this.workspace_ = null;
  this.startWorkspace_ = null;
  this.dragIconData_.length = 0;

  if (Blockly.BlockDragger.perf_) {
    window.cancelAnimationFrame(Blockly.BlockDragger.perf_.raf);
    Blockly.BlockDragger.perf_ = null;
  }

  if (this.draggedConnectionManager_) {
    this.draggedConnectionManager_.dispose();
    this.draggedConnectionManager_ = null;
  }
};

/**
 * Make a list of all of the icons (comment, warning, and mutator) that are
 * on this block and its descendants.  Moving an icon moves the bubble that
 * extends from it if that bubble is open.
 * @param {!Blockly.BlockSvg} block The root block that is being dragged.
 * @return {!Array.<!Object>} The list of all icons and their locations.
 * @private
 */
Blockly.BlockDragger.initIconData_ = function (block) {
  // Build a list of icons that need to be moved and where they started.
  var dragIconData = [];
  var descendants = block.getDescendants(false);
  for (var i = 0, descendant; (descendant = descendants[i]); i++) {
    var icons = descendant.getIcons();
    for (var j = 0; j < icons.length; j++) {
      var data = {
        // goog.math.Coordinate with x and y properties (workspace coordinates).
        location: icons[j].getIconLocation(),
        // Blockly.Icon
        icon: icons[j]
      };
      dragIconData.push(data);
    }
  }
  return dragIconData;
};

/**
 * Start dragging a block.  This includes moving it to the drag surface.
 * @param {!goog.math.Coordinate} currentDragDeltaXY How far the pointer has
 *     moved from the position at mouse down, in pixel units.
 * @package
 */
Blockly.BlockDragger.prototype.startBlockDrag = function (currentDragDeltaXY) {
  if (!Blockly.Events.getGroup()) {
    Blockly.Events.setGroup(true);
  }

  this.workspace_.setResizesEnabled(false);
  Blockly.BlockAnimations.disconnectUiStop();

  if (this.draggingBlock_.getParent()) {
    this.draggingBlock_.unplug();
    var delta = this.pixelsToWorkspaceUnits_(currentDragDeltaXY);
    var newLoc = goog.math.Coordinate.sum(this.startXY_, delta);

    this.draggingBlock_.translate(newLoc.x, newLoc.y);
    Blockly.BlockAnimations.disconnectUiEffect(this.draggingBlock_);
  }
  this.draggingBlock_.setDragging(true);

  // Configure the surface *before* the stack is reparented into it. That reparent is
  // what paints the surface for the first time, so clipping and the shadow have to be in
  // place already -- otherwise the first frame rasterises the full stack height with a
  // blur on top, which is where the 300ms+ stall at the start of a tall drag came from.
  var dragSurface = this.workspace_.blockDragSurface_;
  var tooTall = false;
  if (dragSurface && dragSurface.setShadowEnabled && Blockly.BlockDragSurfaceSvg) {
    var height = this.draggingBlock_.getHeightWidth().height;
    var shadowLimit = Blockly.BlockDragSurfaceSvg.SHADOW_HEIGHT_LIMIT;
    tooTall = shadowLimit > 0 && height > shadowLimit;
    // The shadow is an SVG filter on the group that follows the pointer, so it is
    // re-blurred on every move. Skip it for tall stacks. See SHADOW_HEIGHT_LIMIT.
    dragSurface.setShadowEnabled(!tooTall);
    // Clipping is what keeps a tall stack affordable: the surface is editor-sized, so the
    // stack stays visible anywhere in the editor, but the browser no longer has to
    // rasterise 24000px of it on every move. See setOverflowClipped.
    if (dragSurface.setOverflowClipped) {
      dragSurface.setOverflowClipped(tooTall);
    }
    // Lean paint: drop the per-block highlight path and anti-aliasing while the stack is
    // in the air. Both come back on mouse up. A separate, higher threshold than the
    // shadow's, because losing the highlight is a visible change and a handful of blocks
    // is not worth making it. See setLeanPaint.
    if (dragSurface.setLeanPaint) {
      var leanLimit = Blockly.BlockDragSurfaceSvg.LEAN_PAINT_HEIGHT_LIMIT;
      dragSurface.setLeanPaint(leanLimit > 0 && height > leanLimit);
    }
  }

  // For future consideration: we may be able to put moveToDragSurface inside
  // the block dragger, which would also let the block not track the block drag
  // surface.
  this.draggingBlock_.moveToDragSurface_();

  if (dragSurface && dragSurface.setShadowEnabled) {
    // Dropping the blur must not drop the lift: above the limit a cheap offset shadow on
    // the block itself takes over, so the stack still reads as floating.
    this.draggingBlock_.setDragShadow_(tooTall);
  }

  var toolbox = this.workspace_.getToolbox();
  if (toolbox) {
    var style = this.draggingBlock_.isDeletable() ? 'blocklyToolboxDelete' : 'blocklyToolboxGrab';
    toolbox.addStyle(style);
  }

  this.startPerfProbe_();
};

/**
 * Begin collecting timing for the drag that just started.
 * @private
 */
Blockly.BlockDragger.prototype.startPerfProbe_ = function () {
  if (!Blockly.BlockDragger.PERF) {
    Blockly.BlockDragger.perf_ = null;
    return;
  }
  var size = this.draggingBlock_.getHeightWidth();
  var now = performance.now();
  var probe = {
    start: now,
    lastFrame: now,
    gaps: [],
    calls: 0,
    scriptMs: 0,
    worstScriptMs: 0,
    moveMs: 0,
    blocks: 0,
    height: Math.round(size.height),
    raf: 0
  };
  // Walk the stack once so the report can say what was actually being carried.
  for (var b = this.draggingBlock_; b; b = b.getNextBlock()) {
    probe.blocks++;
  }
  var tick = function () {
    var t = performance.now();
    probe.gaps.push(t - probe.lastFrame);
    probe.lastFrame = t;
    probe.raf = window.requestAnimationFrame(tick);
  };
  probe.raf = window.requestAnimationFrame(tick);
  Blockly.BlockDragger.perf_ = probe;
};

/**
 * Stop the probe and print what it measured.
 * @private
 */
Blockly.BlockDragger.prototype.reportPerf_ = function () {
  var probe = Blockly.BlockDragger.perf_;
  Blockly.BlockDragger.perf_ = null;
  if (!probe) {
    return;
  }
  window.cancelAnimationFrame(probe.raf);
  var wall = performance.now() - probe.start;
  var gaps = probe.gaps.slice().sort(function (a, b) { return a - b; });
  var median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  var worstFrame = gaps.length ? gaps[gaps.length - 1] : 0;
  var avgScript = probe.calls ? probe.scriptMs / probe.calls : 0;
  console.log(
    '[drag] blocks=' + probe.blocks +
    ' stackHeight=' + probe.height +
    ' wall=' + wall.toFixed(0) + 'ms' +
    ' frames=' + gaps.length +
    ' medianFrame=' + median.toFixed(1) + 'ms' +
    ' worstFrame=' + worstFrame.toFixed(0) + 'ms' +
    ' | moveCalls=' + probe.calls +
    ' avgScript=' + avgScript.toFixed(2) + 'ms' +
    ' worstScript=' + probe.worstScriptMs.toFixed(1) + 'ms' +
    ' scriptTotal=' + probe.scriptMs.toFixed(0) + 'ms' +
    ' (' + (wall > 0 ? (100 * probe.scriptMs / wall).toFixed(1) : '0') + '% of wall)' +
    ' | moveDuringDrag=' + (probe.calls ? (probe.moveMs / probe.calls).toFixed(2) : '0') + 'ms avg');
  if (wall > 0 && median > 20 && avgScript < 4) {
    console.log('[drag] script time is small but frames are long: the cost is in ' +
        'style / layout / paint, not in the drag logic.');
  }
};

/**
 * Execute a step of block dragging, based on the given event.  Update the
 * display accordingly.
 * @param {!Event} e The most recent move event.
 * @param {!goog.math.Coordinate} currentDragDeltaXY How far the pointer has
 *     moved from the position at the start of the drag, in pixel units.
 * @package
 * @return {boolean} True if the event should be propagated, false if not.
 */
Blockly.BlockDragger.prototype.dragBlock = function (e, currentDragDeltaXY) {
  var probe = Blockly.BlockDragger.perf_;
  var t0 = probe ? performance.now() : 0;
  var delta = this.pixelsToWorkspaceUnits_(currentDragDeltaXY);
  var newLoc = goog.math.Coordinate.sum(this.startXY_, delta);

  var tMove = probe ? performance.now() : 0;
  this.draggingBlock_.moveDuringDrag(newLoc);
  this.dragIcons_(delta);
  if (probe) {
    probe.moveMs += performance.now() - tMove;
  }

  this.deleteArea_ = this.workspace_.isDeleteArea(e);
  var isOutside = !this.workspace_.isInsideBlocksArea(e);
  this.draggedConnectionManager_.update(delta, this.deleteArea_, isOutside);
  if (isOutside !== this.wasOutside_) {
    this.fireDragOutsideEvent_(isOutside);
    this.wasOutside_ = isOutside;
  }

  this.updateCursorDuringBlockDrag_(isOutside);
  if (probe) {
    var spent = performance.now() - t0;
    probe.calls++;
    probe.scriptMs += spent;
    if (spent > probe.worstScriptMs) {
      probe.worstScriptMs = spent;
    }
  }
  return isOutside;
};

/**
 * Finish a block drag and put the block back on the workspace.
 * @param {!Event} e The mouseup/touchend event.
 * @param {!goog.math.Coordinate} currentDragDeltaXY How far the pointer has
 *     moved from the position at the start of the drag, in pixel units.
 * @package
 */
Blockly.BlockDragger.prototype.endBlockDrag = function (e, currentDragDeltaXY) {
  // Make sure internal state is fresh.
  this.dragBlock(e, currentDragDeltaXY);
  this.dragIconData_ = [];
  var isOutside = this.wasOutside_;
  this.fireEndDragEvent_(isOutside);
  this.draggingBlock_.setMouseThroughStyle(false);

  Blockly.BlockAnimations.disconnectUiStop();

  var delta = this.pixelsToWorkspaceUnits_(currentDragDeltaXY);
  var newLoc = goog.math.Coordinate.sum(this.startXY_, delta);
  this.draggingBlock_.moveOffDragSurface_(newLoc);

  // Scratch-specific: note possible illegal definition deletion for rollback below.
  var isDeletingProcDef =
    this.wouldDeleteBlock_ && this.draggingBlock_.type == Blockly.PROCEDURES_DEFINITION_BLOCK_TYPE;
  if (isDeletingProcDef) {
    var procCodeBeingDeleted = this.draggingBlock_.getInput('custom_block').connection.targetBlock().getProcCode();
  }

  var deleted = this.maybeDeleteBlock_();
  if (!deleted) {
    // These are expensive and don't need to be done if we're deleting.
    this.draggingBlock_.moveConnections_(delta.x, delta.y);
    this.draggingBlock_.setDragging(false);
    this.fireMoveEvent_();
    if (this.draggedConnectionManager_.wouldConnectBlock()) {
      // Applying connections also rerenders the relevant blocks.
      this.draggedConnectionManager_.applyConnections();
    } else {
      this.draggingBlock_.render();
    }
    this.draggingBlock_.scheduleSnapAndBump();
  }
  this.workspace_.setResizesEnabled(true);

  var toolbox = this.workspace_.getToolbox();
  if (toolbox) {
    var style = this.draggingBlock_.isDeletable() ? 'blocklyToolboxDelete' : 'blocklyToolboxGrab';
    toolbox.removeStyle(style);
  }
  Blockly.Events.setGroup(false);

  if (isOutside) {
    var ws = this.workspace_;
    // Reset a drag to outside of scratch-blocks
    setTimeout(function () {
      ws.undo();
    });
  }

  // Scratch-specific: roll back deletes that create call blocks with defines.
  // Have to wait for connections to be re-established, so put in setTimeout.
  // Only do this if we deleted a proc def.
  if (isDeletingProcDef) {
    var ws = this.workspace_;
    setTimeout(function () {
      var allBlocks = ws.getAllBlocks();
      for (var i = 0; i < allBlocks.length; i++) {
        var block = allBlocks[i];
        if (block.type == Blockly.PROCEDURES_CALL_BLOCK_TYPE) {
          var procCode = block.getProcCode();
          // Check for call blocks with no associated define block.
          if (procCode === procCodeBeingDeleted) {
            alert(Blockly.Msg.PROCEDURE_USED);
            ws.undo();
            return; // There can only be one define deletion at a time.
          }
        }
      }
      // The proc deletion was valid, update the toolbox.
      ws.refreshToolboxSelection_();
    });
  }

  this.reportPerf_();
};

/**
 * Fire an event when the dragged blocks move outside or back into the blocks workspace
 * @param {?boolean} isOutside True if the drag is going outside the visible area.
 * @private
 */
Blockly.BlockDragger.prototype.fireDragOutsideEvent_ = function (isOutside) {
  var event = new Blockly.Events.DragBlockOutside(this.draggingBlock_);
  event.isOutside = isOutside;
  Blockly.Events.fire(event);
};

/**
 * Fire an end drag event at the end of a block drag.
 * @param {?boolean} isOutside True if the drag is going outside the visible area.
 * @private
 */
Blockly.BlockDragger.prototype.fireEndDragEvent_ = function (isOutside) {
  var event = new Blockly.Events.EndBlockDrag(this.draggingBlock_, isOutside);
  Blockly.Events.fire(event);
};

/**
 * Fire a move event at the end of a block drag.
 * @private
 */
Blockly.BlockDragger.prototype.fireMoveEvent_ = function () {
  var event = new Blockly.Events.BlockMove(this.draggingBlock_);
  event.oldCoordinate = this.startXY_;
  event.recordNew();
  Blockly.Events.fire(event);
};

/**
 * Shut the trash can and, if necessary, delete the dragging block.
 * Should be called at the end of a block drag.
 * @return {boolean} whether the block was deleted.
 * @private
 */
Blockly.BlockDragger.prototype.maybeDeleteBlock_ = function () {
  var trashcan = this.workspace_.trashcan;

  if (this.wouldDeleteBlock_) {
    if (trashcan) {
      goog.Timer.callOnce(trashcan.close, 100, trashcan);
    }
    // Fire a move event, so we know where to go back to for an undo.
    this.fireMoveEvent_();
    this.draggingBlock_.dispose(false, true);
  } else if (trashcan) {
    // Make sure the trash can is closed.
    trashcan.close();
  }
  return this.wouldDeleteBlock_;
};

/**
 * Update the cursor (and possibly the trash can lid) to reflect whether the
 * dragging block would be deleted if released immediately.
 * @param {boolean} isOutside True if the cursor is outside of the blocks workspace
 * @private
 */
Blockly.BlockDragger.prototype.updateCursorDuringBlockDrag_ = function (isOutside) {
  this.wouldDeleteBlock_ = this.draggedConnectionManager_.wouldDeleteBlock();
  var trashcan = this.workspace_.trashcan;
  if (this.wouldDeleteBlock_) {
    this.draggingBlock_.setDeleteStyle(true);
    if (this.deleteArea_ == Blockly.DELETE_AREA_TRASH && trashcan) {
      trashcan.setOpen_(true);
    }
  } else {
    this.draggingBlock_.setDeleteStyle(false);
    if (trashcan) {
      trashcan.setOpen_(false);
    }
  }

  if (isOutside) {
    // Let mouse events through to GUI
    this.draggingBlock_.setMouseThroughStyle(true);
  } else {
    this.draggingBlock_.setMouseThroughStyle(false);
  }
};

/**
 * Convert a coordinate object from pixels to workspace units, including a
 * correction for mutator workspaces.
 * This function does not consider differing origins.  It simply scales the
 * input's x and y values.
 * @param {!goog.math.Coordinate} pixelCoord A coordinate with x and y values
 *     in css pixel units.
 * @return {!goog.math.Coordinate} The input coordinate divided by the workspace
 *     scale.
 * @private
 */
Blockly.BlockDragger.prototype.pixelsToWorkspaceUnits_ = function (pixelCoord) {
  var result = new goog.math.Coordinate(pixelCoord.x / this.workspace_.scale, pixelCoord.y / this.workspace_.scale);
  if (this.workspace_.isMutator) {
    // If we're in a mutator, its scale is always 1, purely because of some
    // oddities in our rendering optimizations.  The actual scale is the same as
    // the scale on the parent workspace.
    // Fix that for dragging.
    var mainScale = this.workspace_.options.parentWorkspace.scale;
    result = result.scale(1 / mainScale);
  }
  return result;
};

/**
 * Move all of the icons connected to this drag.
 * @param {!goog.math.Coordinate} dxy How far to move the icons from their
 *     original positions, in workspace units.
 * @private
 */
Blockly.BlockDragger.prototype.dragIcons_ = function (dxy) {
  // Moving icons moves their associated bubbles.
  for (var i = 0; i < this.dragIconData_.length; i++) {
    var data = this.dragIconData_[i];
    data.icon.setIconLocation(goog.math.Coordinate.sum(data.location, dxy));
  }
};
