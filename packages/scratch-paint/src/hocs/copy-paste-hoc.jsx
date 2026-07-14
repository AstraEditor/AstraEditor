import paper from '@turbowarp/paper';
import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import omit from 'lodash.omit';
import { connect } from 'react-redux';

import { clearSelection, getAllRootItems, getSelectedLeafItems, getSelectedRootItems } from '../helper/selection';
import { getTrimmedRaster } from '../helper/bitmap';
import Formats, { isBitmap } from '../lib/format';
import Modes from '../lib/modes';

import { clearSelectedItems, setSelectedItems } from '../reducers/selected-items';
import { incrementPasteOffset, setClipboardItems } from '../reducers/clipboard';

const CopyPasteHOC = function (WrappedComponent) {
  class CopyPasteWrapper extends React.Component {
    constructor(props) {
      super(props);
      bindAll(this, ['handleCopy', 'handlePaste', 'handleSystemPaste']);
      this._systemPasteHandled = false;
    }
    componentDidMount() {
      document.addEventListener('paste', this.handleSystemPaste);
    }
    componentWillUnmount() {
      document.removeEventListener('paste', this.handleSystemPaste);
    }

    // Handle paste event from system clipboard (for external images etc.)
    // Only intercepts when the internal clipboard is empty — so internal
    // copy/paste within scratch-paint takes priority.
    handleSystemPaste(event) {
      // Always reset — in case previous paste didn't reach handlePaste
      this._systemPasteHandled = false;

      // If internal clipboard has items, let the regular handler process it
      if (this.props.clipboardItems && this.props.clipboardItems.length > 0) {
        return;
      }

      const clipboardData = event.clipboardData;
      if (!clipboardData || !clipboardData.items) return;

      // Look for image data in the system clipboard
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item.type.startsWith('image/')) {
          event.preventDefault();
          const blob = item.getAsFile();
          const url = URL.createObjectURL(blob);
          const raster = new paper.Raster(url);
          raster.onLoad = () => {
            URL.revokeObjectURL(url);
            clearSelection(this.props.clearSelectedItems);
            const placedItem = paper.project.getActiveLayer().addChild(raster);
            placedItem.selected = true;
            placedItem.position.x += 10 * this.props.pasteOffset;
            placedItem.position.y += 10 * this.props.pasteOffset;
            this.props.incrementPasteOffset();
            this.props.setSelectedItems(this.props.format);
            this.props.onUpdateImage();
          };
          this._systemPasteHandled = true;
          return;
        }
      }
    }
    handleCopy() {
      let selectedItems = [];
      if (this.props.mode === Modes.RESHAPE) {
        const leafItems = getSelectedLeafItems();
        // Copy root of compound paths
        for (const item of leafItems) {
          if (item.parent && item.parent instanceof paper.CompoundPath) {
            selectedItems.push(item.parent);
          } else {
            selectedItems.push(item);
          }
        }
      } else {
        selectedItems = getSelectedRootItems();
      }
      if (selectedItems.length === 0) {
        if (isBitmap(this.props.format)) {
          const raster = getTrimmedRaster(false /* shouldInsert */);
          if (!raster) return;
          selectedItems.push(raster);
        } else {
          selectedItems = getAllRootItems();
        }
      }
      const clipboardItems = [];
      for (let i = 0; i < selectedItems.length; i++) {
        const jsonItem = selectedItems[i].exportJSON({ asString: false });
        clipboardItems.push(jsonItem);
      }
      this.props.setClipboardItems(clipboardItems);
    }
    handlePaste() {
      // If system paste already handled the clipboard (e.g. external image),
      // skip the internal clipboard paste.
      if (this._systemPasteHandled) {
        this._systemPasteHandled = false;
        return;
      }

      clearSelection(this.props.clearSelectedItems);

      if (this.props.clipboardItems.length === 0) return;

      let items = [];
      for (let i = 0; i < this.props.clipboardItems.length; i++) {
        const item = paper.Base.importJSON(this.props.clipboardItems[i]);
        if (item) {
          items.push(item);
        }
      }
      if (!items.length) return;
      // If pasting a group or non-raster to bitmap, rasterize first
      if (isBitmap(this.props.format) && !(items.length === 1 && items[0] instanceof paper.Raster)) {
        const group = new paper.Group(items);
        items = [group.rasterize()];
        group.remove();
      }
      for (const item of items) {
        const placedItem = paper.project.getActiveLayer().addChild(item);
        placedItem.selected = true;
        placedItem.position.x += 10 * this.props.pasteOffset;
        placedItem.position.y += 10 * this.props.pasteOffset;
      }
      this.props.incrementPasteOffset();
      this.props.setSelectedItems(this.props.format);
      this.props.onUpdateImage();
    }
    render() {
      const componentProps = omit(this.props, [
        'clearSelectedItems',
        'clipboardItems',
        'format',
        'incrementPasteOffset',
        'mode',
        'pasteOffset',
        'setClipboardItems',
        'setSelectedItems'
      ]);
      return (
        <WrappedComponent
          onCopyToClipboard={this.handleCopy}
          onPasteFromClipboard={this.handlePaste}
          {...componentProps}
        />
      );
    }
  }

  CopyPasteWrapper.propTypes = {
    clearSelectedItems: PropTypes.func.isRequired,
    clipboardItems: PropTypes.arrayOf(PropTypes.array),
    format: PropTypes.oneOf(Object.keys(Formats)),
    incrementPasteOffset: PropTypes.func.isRequired,
    mode: PropTypes.oneOf(Object.keys(Modes)),
    onUpdateImage: PropTypes.func.isRequired,
    pasteOffset: PropTypes.number,
    setClipboardItems: PropTypes.func.isRequired,
    setSelectedItems: PropTypes.func.isRequired
  };
  const mapStateToProps = (state) => ({
    clipboardItems: state.scratchPaint.clipboard.items,
    format: state.scratchPaint.format,
    mode: state.scratchPaint.mode,
    pasteOffset: state.scratchPaint.clipboard.pasteOffset
  });
  const mapDispatchToProps = (dispatch) => ({
    setClipboardItems: (items) => {
      dispatch(setClipboardItems(items));
    },
    incrementPasteOffset: () => {
      dispatch(incrementPasteOffset());
    },
    clearSelectedItems: () => {
      dispatch(clearSelectedItems());
    },
    setSelectedItems: (format) => {
      dispatch(setSelectedItems(getSelectedLeafItems(), isBitmap(format)));
    }
  });

  return connect(mapStateToProps, mapDispatchToProps)(CopyPasteWrapper);
};

export default CopyPasteHOC;
