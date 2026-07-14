import React, { useRef, useState } from 'react';
import paper from '@turbowarp/paper';
import classNames from 'classnames';
import { defineMessages, injectIntl, intlShape } from 'react-intl';
import PropTypes from 'prop-types';

import PaperCanvas from '../../containers/paper-canvas.jsx';
import ScrollableCanvas from '../../containers/scrollable-canvas.jsx';

import BitBrushMode from '../../containers/bit-brush-mode.jsx';
import BitLineMode from '../../containers/bit-line-mode.jsx';
import BitOvalMode from '../../containers/bit-oval-mode.jsx';
import BitRectMode from '../../containers/bit-rect-mode.jsx';
import BitFillMode from '../../containers/bit-fill-mode.jsx';
import BitEraserMode from '../../containers/bit-eraser-mode.jsx';
import BitSelectMode from '../../containers/bit-select-mode.jsx';
import Box from '../box/box.jsx';
import Button from '../button/button.jsx';
import ButtonGroup from '../button-group/button-group.jsx';
import BrushMode from '../../containers/brush-mode.jsx';
import EraserMode from '../../containers/eraser-mode.jsx';
import FillColorIndicatorComponent from '../../containers/fill-color-indicator.jsx';
import FillMode from '../../containers/fill-mode.jsx';
import InputGroup from '../input-group/input-group.jsx';
import LineMode from '../../containers/line-mode.jsx';
import Loupe from '../loupe/loupe.jsx';
import FixedToolsContainer from '../../containers/fixed-tools.jsx';
import ModeToolsContainer from '../../containers/mode-tools.jsx';
import OvalMode from '../../containers/oval-mode.jsx';
import RectMode from '../../containers/rect-mode.jsx';
import ReshapeMode from '../../containers/reshape-mode.jsx';
import RoundedRectMode from '../../containers/rounded-rect-mode.jsx';
import SelectMode from '../../containers/select-mode.jsx';
import ContextMenu from '../context-menu/context-menu.jsx';
import StrokeColorIndicatorComponent from '../../containers/stroke-color-indicator.jsx';
import StrokeWidthIndicatorComponent from '../../containers/stroke-width-indicator.jsx';
import TextMode from '../../containers/text-mode.jsx';

import Formats, { isBitmap, isVector } from '../../lib/format';
import { getSelectedLeafItems, getSelectedRootItems } from '../../helper/selection';
import styles from './paint-editor.css';

import bitmapIcon from './icons/bitmap.svg';
import zoomInIcon from './icons/zoom-in.svg';
import zoomOutIcon from './icons/zoom-out.svg';
import zoomResetIcon from './icons/zoom-reset.svg';
import themeIcon from './icons/theme.svg';

const messages = defineMessages({
  bitmap: {
    defaultMessage: 'Convert to Bitmap',
    description: 'Label for button that converts the paint editor to bitmap mode',
    id: 'paint.paintEditor.bitmap'
  },
  vector: {
    defaultMessage: 'Convert to Vector',
    description: 'Label for button that converts the paint editor to vector mode',
    id: 'paint.paintEditor.vector'
  },
  importImage: {
    defaultMessage: 'Import image',
    description: 'Label for button that Import image',
    id: 'paint.paintEditor.importImage'
  },
  copyAs: {
    defaultMessage: 'Copy the selected image(s) as {value}',
    description: 'Label for button that copy image',
    id: 'paint.paintEditor.copyImage'
  },
  pasteFromClipboard: {
    defaultMessage: 'Paste from clipboard',
    description: 'Label for button that paste from clipboard',
    id: 'paint.paintEditor.pasteFromClipboard'
  }
});

const PaintEditorComponent = (props) => {
  const [contextMenu, setContextMenu] = useState(null);
  const fileInputRef = useRef(null);

  const handleContextMenu = (e) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleImportImage = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // ----- shared import helpers -----

  const placeItem = (item) => {
    paper.project.getActiveLayer().addChild(item);
    item.position = paper.view.center;
    const maxDim = 480;
    const b = item.bounds;
    if (b.width > maxDim || b.height > maxDim) {
      item.scale(maxDim / Math.max(b.width, b.height));
    }
    paper.project.deselectAll();
    item.selected = true;
    if (props.setSelectedItems) props.setSelectedItems(props.format);
    if (props.onUpdateImage) props.onUpdateImage();
  };

  const importSvgText = (svgText) => {
    const imported = paper.project.importSVG(svgText, {
      expandShapes: true,
      insert: false
    });
    if (!imported) return;
    const items = imported instanceof paper.Item ? [imported] : imported.children || [];
    if (!items.length) return;
    placeItem(items.length === 1 ? items[0] : new paper.Group(items));
  };

  const importBlob = (blob, isSvg) => {
    if (isSvg) {
      const reader = new FileReader();
      reader.onload = () => importSvgText(reader.result);
      reader.readAsText(blob);
    } else {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        placeItem(new paper.Raster(img));
      };
      img.src = url;
    }
  };

  // ----- handlers -----

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const isSvg = file.type === 'image/svg+xml' || file.name.endsWith('.svg');
    e.target.value = '';
    importBlob(file, isSvg);
  };

  const handleCopyAsPNG = async () => {
    const items = isBitmap(props.format) ? getSelectedLeafItems() : getSelectedRootItems();
    if (!items.length) return;
    try {
      // Rasterize the selection
      let raster;
      if (items.length === 1 && items[0] instanceof paper.Raster) {
        raster = items[0];
      } else {
        const group = new paper.Group(items.map((i) => i.clone()));
        raster = group.rasterize();
        group.remove();
      }
      const canvas = raster.canvas;
      if (!canvas) return;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      // Clean up temp raster if we created one
      if (raster !== items[0]) raster.remove();
    } catch (err) {
      console.warn('Copy PNG failed:', err);
    }
  };

  const handleCopyAsSVG = async () => {
    const items = getSelectedRootItems();
    if (!items.length) return;
    try {
      const svgParts = [];
      for (const item of items) {
        const itemSVG = item.exportSVG({ asString: true });
        if (itemSVG) svgParts.push(itemSVG);
      }
      if (!svgParts.length) return;
      const combined = svgParts.join('\n');
      await navigator.clipboard.writeText(combined);
    } catch (err) {
      console.warn('Copy SVG failed:', err);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            importBlob(await item.getType(type), type === 'image/svg+xml');
            return;
          }
        }
      }
    } catch (err) {
      // clipboard read may fail if permission denied or no image data
    }
  };

  const contextMenuItems = [
    { label: props.intl.formatMessage(messages.importImage), onClick: handleImportImage },
    { label: props.intl.formatMessage(messages.pasteFromClipboard), onClick: handlePasteFromClipboard },
    {
      label: props.intl.formatMessage(messages.copyAs, {
        value: 'PNG'
      }),
      onClick: handleCopyAsPNG
    },
    {
      label: props.intl.formatMessage(messages.copyAs, {
        value: 'SVG'
      }),
      onClick: handleCopyAsSVG
    }
  ];

  return (
    <div
      className={styles.editorContainer}
      dir={props.rtl ? 'rtl' : 'ltr'}
      data-paint-theme={props.theme}
      onContextMenu={handleContextMenu}
    >
      {props.canvas !== null ? ( // eslint-disable-line no-negated-condition
        <div className={styles.editorContainerTop}>
          {/* First row */}
          <div className={styles.row}>
            <FixedToolsContainer
              canRedo={props.canRedo}
              canUndo={props.canUndo}
              name={props.name}
              onRedo={props.onRedo}
              onUndo={props.onUndo}
              onUpdateImage={props.onUpdateImage}
              onUpdateName={props.onUpdateName}
              width={props.width}
            />
          </div>
          {/* Second Row */}
          {isVector(props.format) ? (
            <div className={styles.row}>
              <InputGroup className={classNames(styles.row, styles.modDashedBorder, styles.modLabeledIconHeight)}>
                {/* fill */}
                <FillColorIndicatorComponent className={styles.modMarginAfter} onUpdateImage={props.onUpdateImage} />
                {/* stroke */}
                <StrokeColorIndicatorComponent onUpdateImage={props.onUpdateImage} />
                {/* stroke width */}
                <StrokeWidthIndicatorComponent onUpdateImage={props.onUpdateImage} />
              </InputGroup>
              <InputGroup className={styles.modModeTools}>
                <ModeToolsContainer onUpdateImage={props.onUpdateImage} onManageFonts={props.onManageFonts} />
              </InputGroup>
            </div>
          ) : isBitmap(props.format) ? (
            <div className={styles.row}>
              <InputGroup className={classNames(styles.row, styles.modDashedBorder, styles.modLabeledIconHeight)}>
                {/* fill */}
                <FillColorIndicatorComponent className={styles.modMarginAfter} onUpdateImage={props.onUpdateImage} />
              </InputGroup>
              <InputGroup className={styles.modModeTools}>
                <ModeToolsContainer onUpdateImage={props.onUpdateImage} onManageFonts={props.onManageFonts} />
              </InputGroup>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={styles.topAlignRow}>
        {/* Modes */}
        {props.canvas !== null && isVector(props.format) ? ( // eslint-disable-line no-negated-condition
          <div className={styles.modeSelector}>
            <SelectMode onUpdateImage={props.onUpdateImage} />
            <ReshapeMode onUpdateImage={props.onUpdateImage} />
            <BrushMode onUpdateImage={props.onUpdateImage} />
            <EraserMode onUpdateImage={props.onUpdateImage} />
            <FillMode onUpdateImage={props.onUpdateImage} />
            <TextMode textArea={props.textArea} onUpdateImage={props.onUpdateImage} />
            <LineMode onUpdateImage={props.onUpdateImage} />
            <OvalMode onUpdateImage={props.onUpdateImage} />
            <RectMode onUpdateImage={props.onUpdateImage} />
            <RoundedRectMode onUpdateImage={props.onUpdateImage} />
          </div>
        ) : null}

        {props.canvas !== null && isBitmap(props.format) ? ( // eslint-disable-line no-negated-condition
          <div className={styles.modeSelector}>
            <BitBrushMode onUpdateImage={props.onUpdateImage} />
            <BitLineMode onUpdateImage={props.onUpdateImage} />
            <BitOvalMode onUpdateImage={props.onUpdateImage} />
            <BitRectMode onUpdateImage={props.onUpdateImage} />
            <TextMode isBitmap textArea={props.textArea} onUpdateImage={props.onUpdateImage} />
            <BitFillMode onUpdateImage={props.onUpdateImage} />
            <BitEraserMode onUpdateImage={props.onUpdateImage} />
            <BitSelectMode onUpdateImage={props.onUpdateImage} />
          </div>
        ) : null}

        <div className={styles.controlsContainer}>
          {/* Canvas */}
          <ScrollableCanvas canvas={props.canvas} hideScrollbars={props.isEyeDropping} style={styles.canvasContainer}>
            <PaperCanvas
              canvasRef={props.setCanvas}
              image={props.image}
              imageFormat={props.imageFormat}
              imageId={props.imageId}
              rotationCenterX={props.rotationCenterX}
              rotationCenterY={props.rotationCenterY}
              theme={props.theme}
              zoomLevelId={props.zoomLevelId}
              onUpdateImage={props.onUpdateImage}
            />
            <textarea className={styles.textArea} ref={props.setTextArea} spellCheck={false} />
            {props.isEyeDropping && props.colorInfo !== null && !props.colorInfo.hideLoupe ? (
              <Box className={styles.colorPickerWrapper}>
                <Loupe colorInfo={props.colorInfo} pixelRatio={paper.project.view.pixelRatio} theme={props.theme} />
              </Box>
            ) : null}
          </ScrollableCanvas>
          <div className={styles.canvasControls}>
            {isVector(props.format) ? (
              <Button className={styles.bitmapButton} onClick={props.onSwitchToBitmap}>
                <img className={styles.bitmapButtonIcon} draggable={false} src={bitmapIcon} />
                <span className={styles.buttonText}>{props.intl.formatMessage(messages.bitmap)}</span>
              </Button>
            ) : isBitmap(props.format) ? (
              <Button className={styles.bitmapButton} onClick={props.onSwitchToVector}>
                <img className={styles.bitmapButtonIcon} draggable={false} src={bitmapIcon} />
                <span className={styles.buttonText}>{props.intl.formatMessage(messages.vector)}</span>
              </Button>
            ) : null}
            {/* Zoom controls */}
            <InputGroup className={styles.zoomControls}>
              <ButtonGroup>
                <Button className={styles.buttonGroupButton} onClick={props.onZoomOut}>
                  <img alt="Zoom Out" className={styles.buttonGroupButtonIcon} draggable={false} src={zoomOutIcon} />
                </Button>
                <Button className={styles.buttonGroupButton} onClick={props.onZoomReset}>
                  <img
                    alt="Zoom Reset"
                    className={styles.buttonGroupButtonIcon}
                    draggable={false}
                    src={zoomResetIcon}
                  />
                </Button>
                <Button className={styles.buttonGroupButton} onClick={props.onZoomIn}>
                  <img alt="Zoom In" className={styles.buttonGroupButtonIcon} draggable={false} src={zoomInIcon} />
                </Button>
              </ButtonGroup>
              <ButtonGroup>
                <Button className={styles.buttonGroupButton} onClick={props.onChangeTheme}>
                  <img alt="Change theme" className={styles.buttonGroupButtonIcon} draggable={false} src={themeIcon} />
                </Button>
              </ButtonGroup>
            </InputGroup>
          </div>
        </div>
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenuItems}
            onClose={() => setContextMenu(null)}
          />
        )}
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept="image/*"
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
};

PaintEditorComponent.propTypes = {
  canRedo: PropTypes.func.isRequired,
  canUndo: PropTypes.func.isRequired,
  canvas: PropTypes.instanceOf(Element),
  colorInfo: Loupe.propTypes.colorInfo,
  format: PropTypes.oneOf(Object.keys(Formats)),
  image: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(HTMLImageElement)]),
  imageFormat: PropTypes.string,
  imageId: PropTypes.string,
  intl: intlShape,
  isEyeDropping: PropTypes.bool,
  name: PropTypes.string,
  onChangeTheme: PropTypes.func.isRequired,
  onManageFonts: PropTypes.func,
  onRedo: PropTypes.func.isRequired,
  onSwitchToBitmap: PropTypes.func.isRequired,
  onSwitchToVector: PropTypes.func.isRequired,
  onUndo: PropTypes.func.isRequired,
  onUpdateImage: PropTypes.func.isRequired,
  onUpdateName: PropTypes.func.isRequired,
  onZoomIn: PropTypes.func.isRequired,
  onZoomOut: PropTypes.func.isRequired,
  onZoomReset: PropTypes.func.isRequired,
  rotationCenterX: PropTypes.number,
  rotationCenterY: PropTypes.number,
  rtl: PropTypes.bool,
  setCanvas: PropTypes.func.isRequired,
  setSelectedItems: PropTypes.func,
  setTextArea: PropTypes.func.isRequired,
  textArea: PropTypes.instanceOf(Element),
  theme: PropTypes.string,
  width: PropTypes.number,
  zoomLevelId: PropTypes.string
};

export default injectIntl(PaintEditorComponent);
