/**
 * @license
 * Visual Blocks Editor
 *
 * Copyright 2016 Google Inc.
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
 * @fileoverview A class that manages a surface for dragging blocks.  When a
 * block drag is started, we move the block (and children) to a separate DOM
 * element that we move around using translate3d. At the end of the drag, the
 * blocks are put back in into the SVG they came from. This helps performance by
 * avoiding repainting the entire SVG on every mouse move while dragging blocks.
 * @author picklesrus
 */

'use strict';

goog.provide('Blockly.BlockDragSurfaceSvg');
goog.require('Blockly.utils');
goog.require('goog.asserts');
goog.require('goog.math.Coordinate');

/**
 * Class for a drag surface for the currently dragged block. This is a separate
 * SVG that contains only the currently moving block, or nothing.
 * @param {!Element} container Containing element.
 * @constructor
 */
Blockly.BlockDragSurfaceSvg = function (container) {
  /**
   * @type {!Element}
   * @private
   */
  this.container_ = container;
  this.createDom();
};

/**
 * The SVG drag surface. Set once by Blockly.BlockDragSurfaceSvg.createDom.
 * @type {Element}
 * @private
 */
Blockly.BlockDragSurfaceSvg.prototype.SVG_ = null;

/**
 * This is where blocks live while they are being dragged if the drag surface
 * is enabled.
 * @type {Element}
 * @private
 */
Blockly.BlockDragSurfaceSvg.prototype.dragGroup_ = null;

/**
 * Containing HTML element; parent of the workspace and the drag surface.
 * @type {Element}
 * @private
 */
Blockly.BlockDragSurfaceSvg.prototype.container_ = null;

/**
 * Cached value for the scale of the drag surface.
 * Used to set/get the correct translation during and after a drag.
 * @type {number}
 * @private
 */
Blockly.BlockDragSurfaceSvg.prototype.scale_ = 1;

/**
 * Cached value for the translation of the drag surface.
 * This translation is in pixel units, because the scale is applied to the
 * drag group rather than the top-level SVG.
 * @type {goog.math.Coordinate}
 * @private
 */
Blockly.BlockDragSurfaceSvg.prototype.surfaceXY_ = null;

/**
 * ID for the drag shadow filter, set in createDom.
 * Belongs in Scratch Blocks but not Blockly.
 * @type {string}
 * @private
 */
Blockly.BlockDragSurfaceSvg.prototype.dragShadowFilterId_ = '';

/**
 * Standard deviation for gaussian blur on drag shadow, in px.
 * Belongs in Scratch Blocks but not Blockly.
 * @type {number}
 * @const
 */
Blockly.BlockDragSurfaceSvg.SHADOW_STD_DEVIATION = 6;

/**
 * Height, in workspace units, above which the drag shadow is skipped.
 *
 * The shadow is a real SVG filter, and the filter is attached to the group that moves
 * with the pointer, so every pointer move re-runs a gaussian blur plus a composite over
 * the whole dragged stack. A tall stack therefore re-blurs millions of pixels per frame,
 * which is what makes dragging feel sticky in large projects.
 *
 * Below this height the shadow is kept (a single block, a couple of blocks). Above it the
 * filter is dropped for the duration of the drag. Set to 0 to always keep the shadow.
 * @const {number}
 */
Blockly.BlockDragSurfaceSvg.SHADOW_HEIGHT_LIMIT = 600;

/**
 * Height, in workspace units, above which the dragged stack drops its per-block highlight
 * path and anti-aliasing for the duration of the drag.
 *
 * Higher than SHADOW_HEIGHT_LIMIT on purpose: losing the shadow blur is invisible, losing
 * the highlight is not, and a stack of a dozen blocks does not need the saving. Around
 * 30 blocks.
 * @const {number}
 */
Blockly.BlockDragSurfaceSvg.LEAN_PAINT_HEIGHT_LIMIT = 1200;

/**
 * Whether the drag surface is promoted to its own compositing layer while dragging.
 *
 * The surface is a transparent, absolutely positioned SVG stacked above the workspace,
 * and its transform changes on every pointer move. Without a compositing hint the
 * browser cannot just slide the layer: it has to repaint the moved surface *and* every
 * block underneath it in the affected region, every frame. With tens of thousands of
 * SVG nodes in the workspace that is what turns a drag into a slideshow.
 *
 * Promoting it lets the compositor scroll the existing raster instead, so the cost of a
 * move no longer scales with what is visible underneath.
 * @const {boolean}
 */
Blockly.BlockDragSurfaceSvg.COMPOSITE_MOVE = true;

/**
 * Create the drag surface and inject it into the container.
 */
Blockly.BlockDragSurfaceSvg.prototype.createDom = function () {
  if (this.SVG_) {
    return; // Already created.
  }
  this.composited_ = Blockly.BlockDragSurfaceSvg.COMPOSITE_MOVE;
  this.SVG_ = Blockly.utils.createSvgElement(
    'svg',
    {
      xmlns: Blockly.SVG_NS,
      'xmlns:html': Blockly.HTML_NS,
      'xmlns:xlink': 'http://www.w3.org/1999/xlink',
      version: '1.1',
      class: 'blocklyBlockDragSurface'
    },
    this.container_
  );
  this.dragGroup_ = Blockly.utils.createSvgElement('g', {}, this.SVG_);
  // Belongs in Scratch Blocks, but not Blockly.
  var defs = Blockly.utils.createSvgElement('defs', {}, this.SVG_);
  this.dragShadowFilterId_ = this.createDropShadowDom_(defs);
  this.dragShadowFilterUrl_ = 'url(#' + this.dragShadowFilterId_ + ')';
  this.dragGroup_.setAttribute('filter', this.dragShadowFilterUrl_);
  this.applyCompositing_();
  this.releaseInjectionOverflow_();
};

/**
 * Let the drag surface paint outside the injection container, once.
 *
 * A stack has to be carriable over the palette and off the edge of the editor, and the
 * injection div clips its children, so its overflow has to be visible. The old code
 * toggled that per drag (visible when the drag started, hidden when it ended). Each
 * toggle invalidates layout for the *entire* editor -- palette, flyout, stage, all of
 * it -- which cost ~350ms on mouseup and a similar stall when the drag began, on stacks
 * of every size. Setting it once at creation keeps the visual behaviour and drops both
 * stalls.
 *
 * Nothing else in the editor relies on that clipping: the workspace <svg> carries its own
 * overflow:hidden, so blocks inside the canvas still stop at its edges.
 * @private
 */
Blockly.BlockDragSurfaceSvg.prototype.releaseInjectionOverflow_ = function () {
  var node = this.container_;
  while (node && node.nodeType === 1) {
    var cls = node.getAttribute && node.getAttribute('class');
    if (cls && (' ' + cls + ' ').indexOf(' injectionDiv ') !== -1) {
      node.style.overflow = 'visible';
      return;
    }
    node = node.parentNode;
  }
};

/**
 * Apply (or remove) the compositing hint on the drag surface.
 * @private
 */
Blockly.BlockDragSurfaceSvg.prototype.applyCompositing_ = function () {
  if (!this.SVG_) {
    return;
  }
  this.SVG_.style.willChange = this.composited_ ? 'transform' : 'auto';
};

/**
 * Turn composited dragging on or off at runtime, so the trade-off can be measured in the
 * browser without a rebuild. Safe to call at any time.
 * @param {boolean} enabled Whether the drag surface should get its own layer.
 */
Blockly.BlockDragSurfaceSvg.prototype.setCompositing = function (enabled) {
  this.composited_ = !!enabled;
  this.applyCompositing_();
  if (this.SVG_ && this.SVG_.style.display !== 'none') {
    this.translateSurfaceInternal_();
  }
};

/**
 * Turn the drag shadow filter on or off.
 *
 * Kept as a method rather than a direct attribute write so the filter URL is set and
 * removed consistently, and so callers never have to know the generated filter id.
 * @param {boolean} enabled Whether the shadow should be drawn while dragging.
 */
Blockly.BlockDragSurfaceSvg.prototype.setShadowEnabled = function (enabled) {
  if (!this.dragGroup_ || !this.dragShadowFilterUrl_) {
    return;
  }
  if (enabled) {
    if (this.dragGroup_.getAttribute('filter') !== this.dragShadowFilterUrl_) {
      this.dragGroup_.setAttribute('filter', this.dragShadowFilterUrl_);
    }
  } else if (this.dragGroup_.hasAttribute('filter')) {
    this.dragGroup_.removeAttribute('filter');
  }
};

/**
 * Scratch-specific: Create the SVG def for the drop shadow.
 * @param {Element} defs Defs element to insert the shadow filter definition
 * @return {string} ID for the filter element
 * @private
 */
Blockly.BlockDragSurfaceSvg.prototype.createDropShadowDom_ = function (defs) {
  var rnd = String(Math.random()).substring(2);
  // Adjust these width/height, x/y properties to stop the shadow from clipping
  var dragShadowFilter = Blockly.utils.createSvgElement(
    'filter',
    {
      id: 'blocklyDragShadowFilter' + rnd,
      height: '140%',
      width: '140%',
      y: '-20%',
      x: '-20%'
    },
    defs
  );
  Blockly.utils.createSvgElement(
    'feGaussianBlur',
    {
      in: 'SourceAlpha',
      stdDeviation: Blockly.BlockDragSurfaceSvg.SHADOW_STD_DEVIATION
    },
    dragShadowFilter
  );
  var componentTransfer = Blockly.utils.createSvgElement(
    'feComponentTransfer',
    { result: 'offsetBlur' },
    dragShadowFilter
  );
  // Shadow opacity is specified in the adjustable colour library,
  // since the darkness of the shadow largely depends on the workspace colour.
  Blockly.utils.createSvgElement(
    'feFuncA',
    {
      type: 'linear',
      slope: Blockly.Colours.dragShadowOpacity
    },
    componentTransfer
  );
  Blockly.utils.createSvgElement(
    'feComposite',
    {
      in: 'SourceGraphic',
      in2: 'offsetBlur',
      operator: 'over'
    },
    dragShadowFilter
  );
  return dragShadowFilter.id;
};

/**
 * Turn the drag surface's own clipping on or off.
 *
 * The surface is exactly as large as the editor, so with clipping on a stack is still
 * fully visible anywhere inside the editor -- over the palette, over the sprite pane --
 * but the rasterised area stops at the editor bounds instead of growing with the stack.
 * That matters because the browser has to rasterise everything the surface paints: a
 * 24000px stack that is clipped to a 900px surface only costs 900px of raster, while the
 * unclipped version costs the full stack height on every move.
 *
 * Off by default so short stacks keep the original behaviour of staying visible even when
 * dragged outside the editor window.
 * @param {boolean} clipped Whether to clip to the surface bounds.
 */
Blockly.BlockDragSurfaceSvg.prototype.setOverflowClipped = function (clipped) {
  if (!this.SVG_) {
    return;
  }
  var value = clipped ? 'hidden' : 'visible';
  if (this.SVG_.style.overflow !== value) {
    this.SVG_.style.overflow = value;
  }
};

/**
 * Switch the surface into a cheaper paint mode.
 *
 * Moving the surface is already pure compositing -- it is a translate3d on a layer that
 * carries will-change, so a pointer move repaints nothing. What a drag actually costs is
 * the paint that follows the reparent: the browser walks every block in the stack and
 * rasterises every path in it, and that cost is what grows with stack length.
 *
 * Lean mode attacks the per-path cost instead of the node count: dropping the highlight
 * path removes one of the two filled paths every block carries, and optimizeSpeed skips
 * anti-aliasing on geometry that is moving. A block loses its top highlight while it is
 * in the air and gets it back on mouse up.
 *
 * Intended for tall stacks only -- a single block looks better with its highlight.
 * @param {boolean} enabled Whether lean painting is on.
 */
Blockly.BlockDragSurfaceSvg.prototype.setLeanPaint = function (enabled) {
  if (!this.SVG_) {
    return;
  }
  if (enabled) {
    Blockly.utils.addClass(this.SVG_, 'blocklyDragSurfaceLean');
  } else {
    Blockly.utils.removeClass(this.SVG_, 'blocklyDragSurfaceLean');
  }
};

/**
 * Set the SVG blocks on the drag surface's group and show the surface.
 * Only one block group should be on the drag surface at a time.
 * @param {!Element} blocks Block or group of blocks to place on the drag
 * surface.
 */
Blockly.BlockDragSurfaceSvg.prototype.setBlocksAndShow = function (blocks) {
  goog.asserts.assert(this.dragGroup_.childNodes.length == 0, 'Already dragging a block.');
  // appendChild removes the blocks from the previous parent
  this.dragGroup_.appendChild(blocks);
  this.SVG_.style.display = 'block';
  this.surfaceXY_ = new goog.math.Coordinate(0, 0);
};

/**
 * Translate and scale the entire drag surface group to the given position, to
 * keep in sync with the workspace.
 * @param {number} x X translation in workspace coordinates.
 * @param {number} y Y translation in workspace coordinates.
 * @param {number} scale Scale of the group.
 */
Blockly.BlockDragSurfaceSvg.prototype.translateAndScaleGroup = function (x, y, scale) {
  this.scale_ = scale;
  // This is a work-around to prevent a the blocks from rendering
  // fuzzy while they are being dragged on the drag surface.
  var fixedX = x.toFixed(0);
  var fixedY = y.toFixed(0);
  this.dragGroup_.setAttribute('transform', 'translate(' + fixedX + ',' + fixedY + ') scale(' + scale + ')');
};

/**
 * Translate the drag surface's SVG based on its internal state.
 * @private
 */
Blockly.BlockDragSurfaceSvg.prototype.translateSurfaceInternal_ = function () {
  var x = this.surfaceXY_.x;
  var y = this.surfaceXY_.y;
  // This is a work-around to prevent a the blocks from rendering
  // fuzzy while they are being dragged on the drag surface.
  x = x.toFixed(0);
  y = y.toFixed(0);
  if (this.SVG_.style.display !== 'block') {
    this.SVG_.style.display = 'block';
  }

  // A 3d transform is what actually gets the surface onto the compositor; a 2d one only
  // does so when a will-change/transform hint is present. Both are kept so that the
  // behavior does not depend on the hint surviving downstream stylesheets.
  var transform = this.composited_ ?
    'translate3d(' + x + 'px, ' + y + 'px, 0)' :
    'translate(' + x + 'px, ' + y + 'px)';
  Blockly.utils.setCssTransform(this.SVG_, transform);
};

/**
 * Translate the entire drag surface during a drag.
 * We translate the drag surface instead of the blocks inside the surface
 * so that the browser avoids repainting the SVG.
 * Because of this, the drag coordinates must be adjusted by scale.
 * @param {number} x X translation for the entire surface.
 * @param {number} y Y translation for the entire surface.
 */
Blockly.BlockDragSurfaceSvg.prototype.translateSurface = function (x, y) {
  this.surfaceXY_ = new goog.math.Coordinate(x * this.scale_, y * this.scale_);
  this.translateSurfaceInternal_();
};

/**
 * Reports the surface translation in scaled workspace coordinates.
 * Use this when finishing a drag to return blocks to the correct position.
 * @return {!goog.math.Coordinate} Current translation of the surface.
 */
Blockly.BlockDragSurfaceSvg.prototype.getSurfaceTranslation = function () {
  var xy = Blockly.utils.getRelativeXY(this.SVG_);
  return new goog.math.Coordinate(xy.x / this.scale_, xy.y / this.scale_);
};

/**
 * Provide a reference to the drag group (primarily for
 * BlockSvg.getRelativeToSurfaceXY).
 * @return {Element} Drag surface group element.
 */
Blockly.BlockDragSurfaceSvg.prototype.getGroup = function () {
  return this.dragGroup_;
};

/**
 * Get the current blocks on the drag surface, if any (primarily
 * for BlockSvg.getRelativeToSurfaceXY).
 * @return {!Element|undefined} Drag surface block DOM element, or undefined
 * if no blocks exist.
 */
Blockly.BlockDragSurfaceSvg.prototype.getCurrentBlock = function () {
  return this.dragGroup_.firstChild;
};

/**
 * Clear the group and hide the surface; move the blocks off onto the provided
 * element.
 * If the block is being deleted it doesn't need to go back to the original
 * surface, since it would be removed immediately during dispose.
 * @param {Element=} opt_newSurface Surface the dragging blocks should be moved
 *     to, or null if the blocks should be removed from this surface without
 *     being moved to a different surface.
 */
Blockly.BlockDragSurfaceSvg.prototype.clearAndHide = function (opt_newSurface) {
  if (opt_newSurface) {
    // appendChild removes the node from this.dragGroup_
    opt_newSurface.appendChild(this.getCurrentBlock());
  } else {
    this.dragGroup_.removeChild(this.getCurrentBlock());
  }
  this.SVG_.style.display = 'none';
  goog.asserts.assert(this.dragGroup_.childNodes.length == 0, 'Drag group was not cleared.');
  this.surfaceXY_ = null;
  // The blocks are back on the canvas now, where they should keep their highlights, so
  // lean paint must not outlive the drag.
  this.setLeanPaint(false);
};
