import classNames from 'classnames';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import React from 'react';
import MediaQuery from 'react-responsive';

import { changeBrushSize } from '../../reducers/brush-mode';
import { changeBrushSize as changeEraserSize } from '../../reducers/eraser-mode';
import { changeBitBrushSize } from '../../reducers/bit-brush-size';
import { changeBitEraserSize } from '../../reducers/bit-eraser-size';
import { changeCornerRadius } from '../../reducers/rounded-rect-mode';
import { setShapesFilled } from '../../reducers/fill-bitmap-shapes';
import { toggleProportionalShape } from '../../reducers/proportional-shape';

import FontDropdown from '../../containers/font-dropdown.jsx';
import LiveInputHOC from '../forms/live-input-hoc.jsx';
import Label from '../forms/label.jsx';
import { defineMessages, injectIntl, intlShape } from 'react-intl';
import Input from '../forms/input.jsx';
import InputGroup from '../input-group/input-group.jsx';
import LabeledIconButton from '../labeled-icon-button/labeled-icon-button.jsx';
import Button from '../button/button.jsx';
import Dropdown from '../dropdown/dropdown.jsx';
import Modes from '../../lib/modes';
import Formats, { isBitmap, isVector } from '../../lib/format';
import { hideLabel } from '../../lib/hide-label';
import layout from '../../lib/layout-constants';
import styles from './mode-tools.css';

import copyIcon from '!../../tw-recolor/build!./icons/copy.svg';
import pasteIcon from '!../../tw-recolor/build!./icons/paste.svg';
import deleteIcon from '!../../tw-recolor/build!./icons/delete.svg';

import bitBrushIcon from '../bit-brush-mode/brush.svg';
import bitEraserIcon from '../bit-eraser-mode/eraser.svg';
import bitLineIcon from '../bit-line-mode/line.svg';
import brushIcon from '../brush-mode/brush.svg';
import curvedPointIcon from '!../../tw-recolor/build!./icons/curved-point.svg';
import eraserIcon from '../eraser-mode/eraser.svg';
import flipHorizontalIcon from '!../../tw-recolor/build!./icons/flip-horizontal.svg';
import flipVerticalIcon from '!../../tw-recolor/build!./icons/flip-vertical.svg';
import rotateIcon from './icons/rotate.svg';
import straightPointIcon from '!../../tw-recolor/build!./icons/straight-point.svg';
import bitOvalIcon from '../bit-oval-mode/oval.svg';
import bitRectIcon from '../bit-rect-mode/rectangle.svg';
import bitOvalOutlinedIcon from '../bit-oval-mode/oval-outlined.svg';
import bitRectOutlinedIcon from '../bit-rect-mode/rectangle-outlined.svg';

import roundIcon from '../rounded-rect-mode/rounded-rectangle-size.svg'

import uniteIcon from '!../../tw-recolor/build!./icons/unite.svg'
import intersectIcon from '!../../tw-recolor/build!./icons/intersect.svg'
import subtractIcon from '!../../tw-recolor/build!./icons/subtract.svg'
import splitIcon from '!../../tw-recolor/build!./icons/split.svg'
import proportionalIcon from '!../../tw-recolor/build!./icons/proportional.svg'

import TWRenderRecoloredImage from '../../tw-recolor/render.jsx';


import { MAX_STROKE_WIDTH } from '../../reducers/stroke-width';

const LiveInput = LiveInputHOC(Input);
const ModeToolsComponent = props => {
    const messages = defineMessages({
        brushSize: {
            defaultMessage: 'Size',
            description: 'Label for the brush size input',
            id: 'paint.modeTools.brushSize'
        },
        eraserSize: {
            defaultMessage: 'Eraser size',
            description: 'Label for the eraser size input',
            id: 'paint.modeTools.eraserSize'
        },
        cornerRadius: {
            defaultMessage: 'Corner Radius',
            description: 'Label for the corner radius input',
            id: 'paint.modeTools.cornerRadius'
        },
        boolean: {
            defaultMessage: 'Boolean',
            description: 'Label for the dropdown to access boolean operation buttons',
            id: 'paint.modeTools.boolean'
        },
        unite: {
            defaultMessage: 'Unite',
            description: 'Label for the unite button',
            id: 'paint.modeTools.unite'
        },
        intersect: {
            defaultMessage: 'Intersect',
            description: 'Label for the intersect button',
            id: 'paint.modeTools.intersect'
        },
        subtract: {
            defaultMessage: 'Subtract',
            description: 'Label for the subtract button',
            id: 'paint.modeTools.subtract'
        },
        split: {
            defaultMessage: 'Split',
            description: 'Label for the split button',
            id: 'paint.modeTools.split'
        },
        copy: {
            defaultMessage: 'Copy',
            description: 'Label for the copy button',
            id: 'paint.modeTools.copy'
        },
        paste: {
            defaultMessage: 'Paste',
            description: 'Label for the paste button',
            id: 'paint.modeTools.paste'
        },
        delete: {
            defaultMessage: 'Delete',
            description: 'Label for the delete button',
            id: 'paint.modeTools.delete'
        },
        more: {
            defaultMessage: 'More',
            description: 'Label for the dropdown to access copy/paste/delete buttons',
            id: 'paint.modeTools.more'
        },
        curved: {
            defaultMessage: 'Curved',
            description: 'Label for the button that converts selected points to curves',
            id: 'paint.modeTools.curved'
        },
        pointed: {
            defaultMessage: 'Pointed',
            description: 'Label for the button that converts selected points to sharp points',
            id: 'paint.modeTools.pointed'
        },
        thickness: {
            defaultMessage: 'Thickness',
            description: 'Label for the number input to choose the line thickness',
            id: 'paint.modeTools.thickness'
        },
        flipHorizontal: {
            defaultMessage: 'Flip Horizontal',
            description: 'Label for the button to flip the image horizontally',
            id: 'paint.modeTools.flipHorizontal'
        },
        flipVertical: {
            defaultMessage: 'Flip Vertical',
            description: 'Label for the button to flip the image vertically',
            id: 'paint.modeTools.flipVertical'
        },
        filled: {
            defaultMessage: 'Filled',
            description: 'Label for the button that sets the bitmap rectangle/oval mode to draw outlines',
            id: 'paint.modeTools.filled'
        },
        outlined: {
            defaultMessage: 'Outlined',
            description: 'Label for the button that sets the bitmap rectangle/oval mode to draw filled-in shapes',
            id: 'paint.modeTools.outlined'
        },
        rotation: {
            defaultMessage: 'Rotation',
            description: 'Label for the rotation input',
            id: 'paint.modeTools.rotation'
        },
        proportional: {
            defaultMessage: 'Proportional',
            description: 'Label for the button that toggles proportional shape drawing',
            id: 'paint.modeTools.proportional'
        }
    });

    switch (props.mode) {
        case Modes.BRUSH:
        /* falls through */
        case Modes.BIT_BRUSH:
        /* falls through */
        case Modes.BIT_LINE:
            {
                const currentIcon = isVector(props.format) ? brushIcon :
                    props.mode === Modes.BIT_LINE ? bitLineIcon : bitBrushIcon;
                const currentBrushValue = isBitmap(props.format) ? props.bitBrushSize : props.brushValue;
                const changeFunction = isBitmap(props.format) ? props.onBitBrushSliderChange : props.onBrushSliderChange;
                const currentMessage = props.mode === Modes.BIT_LINE ? messages.thickness : messages.brushSize;
                return (
                    <div className={classNames(props.className, styles.modeTools)}>
                        <div>
                            <img
                                alt={props.intl.formatMessage(currentMessage)}
                                className={styles.modeToolsIcon}
                                draggable={false}
                                src={currentIcon}
                            />
                        </div>
                        <LiveInput
                            range
                            small
                            max={MAX_STROKE_WIDTH}
                            min="1"
                            type="number"
                            value={currentBrushValue}
                            onSubmit={changeFunction}
                        />
                    </div>
                );
            }
        case Modes.BIT_ERASER:
        /* falls through */
        case Modes.ERASER:
            {
                const currentIcon = isVector(props.format) ? eraserIcon : bitEraserIcon;
                const currentEraserValue = isBitmap(props.format) ? props.bitEraserSize : props.eraserValue;
                const changeFunction = isBitmap(props.format) ? props.onBitEraserSliderChange : props.onEraserSliderChange;
                return (
                    <div className={classNames(props.className, styles.modeTools)}>
                        <div>
                            <img
                                alt={props.intl.formatMessage(messages.eraserSize)}
                                className={styles.modeToolsIcon}
                                draggable={false}
                                src={currentIcon}
                            />
                        </div>
                        <LiveInput
                            range
                            small
                            max={MAX_STROKE_WIDTH}
                            min="1"
                            type="number"
                            value={currentEraserValue}
                            onSubmit={changeFunction}
                        />
                    </div>
                );
            }
        case Modes.RESHAPE:
            return (
                <div className={classNames(props.className, styles.modeTools)}>
                    <InputGroup className={classNames(styles.modDashedBorder, styles.modLabeledIconHeight)}>
                        <LabeledIconButton
                            disabled={!props.hasSelectedUncurvedPoints}
                            hideLabel={hideLabel(props.intl.locale)}
                            imgSrc={curvedPointIcon}
                            title={props.intl.formatMessage(messages.curved)}
                            onClick={props.onCurvePoints}
                        />
                        <LabeledIconButton
                            disabled={!props.hasSelectedUnpointedPoints}
                            hideLabel={hideLabel(props.intl.locale)}
                            imgSrc={straightPointIcon}
                            title={props.intl.formatMessage(messages.pointed)}
                            onClick={props.onPointPoints}
                        />
                    </InputGroup>
                    <InputGroup className={classNames(styles.modLabeledIconHeight)}>
                        <LabeledIconButton
                            hideLabel={hideLabel(props.intl.locale)}
                            imgSrc={deleteIcon}
                            title={props.intl.formatMessage(messages.delete)}
                            onClick={props.onDelete}
                        />
                    </InputGroup>
                </div>
            );
        case Modes.BIT_SELECT:
        /* falls through */
        case Modes.SELECT: {
            const booleanDisabled = !props.selectedItems || props.selectedItems.length < 2;
            return (
                <div className={classNames(props.className, styles.modeTools)}>
                    <InputGroup>
                        <div>
                            <img
                                alt={props.intl.formatMessage(messages.rotation)}
                                className={styles.modeToolsIcon}
                                draggable={false}
                                src={rotateIcon}
                            />
                        </div>
                        <LiveInput
                            small
                            type="number"
                            value={props.rotation}
                            onSubmit={props.onRotationChange}
                        />

                    </InputGroup>
                    {/* Copy/Paste/Delete — wide screen (width >= 1550): direct buttons */}
                    <MediaQuery minWidth={1550}>
                        <InputGroup className={classNames(styles.modDashedBorder, styles.modLabeledIconHeight)}>
                            <LabeledIconButton
                                hideLabel={hideLabel(props.intl.locale)}
                                imgSrc={copyIcon}
                                title={props.intl.formatMessage(messages.copy)}
                                onClick={props.onCopyToClipboard}
                            />
                            <LabeledIconButton
                                disabled={!(props.clipboardItems.length > 0)}
                                hideLabel={hideLabel(props.intl.locale)}
                                imgSrc={pasteIcon}
                                title={props.intl.formatMessage(messages.paste)}
                                onClick={props.onPasteFromClipboard}
                            />
                        </InputGroup>
                        <InputGroup className={classNames(styles.modDashedBorder, styles.modLabeledIconHeight)}>
                            <LabeledIconButton
                                hideLabel={hideLabel(props.intl.locale)}
                                imgSrc={deleteIcon}
                                title={props.intl.formatMessage(messages.delete)}
                                onClick={props.onDelete}
                            />
                        </InputGroup>
                    </MediaQuery>
                    {/* Copy/Paste/Delete — narrow screen (width <= 1549): dropdown */}
                    <MediaQuery maxWidth={1549}>
                        <InputGroup className={classNames(styles.modDashedBorder, styles.modLabeledIconHeight)}>
                            <Dropdown
                                className={styles.modUnselect}
                                enterExitTransitionDurationMs={20}
                                popoverContent={
                                    <InputGroup className={styles.modContextMenu}>
                                        <Button
                                            className={styles.modMenuItem}
                                            onClick={props.onCopyToClipboard}
                                        >
                                            <TWRenderRecoloredImage
                                                className={styles.menuItemIcon}
                                                draggable={false}
                                                src={copyIcon}
                                            />
                                            <span>{props.intl.formatMessage(messages.copy)}</span>
                                        </Button>
                                        <Button
                                            className={classNames(styles.modMenuItem, {
                                                [styles.modDisabled]: !(props.clipboardItems.length > 0)
                                            })}
                                            disabled={!(props.clipboardItems.length > 0)}
                                            onClick={props.onPasteFromClipboard}
                                        >
                                            <TWRenderRecoloredImage
                                                className={styles.menuItemIcon}
                                                draggable={false}
                                                src={pasteIcon}
                                            />
                                            <span>{props.intl.formatMessage(messages.paste)}</span>
                                        </Button>
                                        <Button
                                            className={styles.modMenuItem}
                                            onClick={props.onDelete}
                                        >
                                            <TWRenderRecoloredImage
                                                className={styles.menuItemIcon}
                                                draggable={false}
                                                src={deleteIcon}
                                            />
                                            <span>{props.intl.formatMessage(messages.delete)}</span>
                                        </Button>
                                    </InputGroup>
                                }
                                tipSize={.01}
                            >
                                {props.intl.formatMessage(messages.more)}
                            </Dropdown>
                        </InputGroup>
                    </MediaQuery>
                    <InputGroup className={classNames(styles.modDashedBorder, styles.modLabeledIconHeight)}>
                        <LabeledIconButton
                            hideLabel={props.intl.locale !== 'en'}
                            imgSrc={flipHorizontalIcon}
                            title={props.intl.formatMessage(messages.flipHorizontal)}
                            onClick={props.onFlipHorizontal}
                        />
                        <LabeledIconButton
                            hideLabel={props.intl.locale !== 'en'}
                            imgSrc={flipVerticalIcon}
                            title={props.intl.formatMessage(messages.flipVertical)}
                            onClick={props.onFlipVertical}
                        />
                    </InputGroup>
                    {/* Boolean operations — wide screen (width >= 1550): direct buttons */}
                    <MediaQuery minWidth={1550}>
                        <InputGroup className={classNames(styles.modLabeledIconHeight)}>
                            <LabeledIconButton
                                disabled={booleanDisabled}
                                hideLabel={hideLabel(props.intl.locale)}
                                imgSrc={uniteIcon}
                                title={props.intl.formatMessage(messages.unite)}
                                onClick={props.onUniteShapes}
                            />
                            <LabeledIconButton
                                disabled={booleanDisabled}
                                hideLabel={hideLabel(props.intl.locale)}
                                imgSrc={intersectIcon}
                                title={props.intl.formatMessage(messages.intersect)}
                                onClick={props.onIntersectShapes}
                            />
                        </InputGroup>
                        <InputGroup className={classNames(styles.modDashedBorder, styles.modLabeledIconHeight)}>
                            <LabeledIconButton
                                disabled={booleanDisabled}
                                hideLabel={hideLabel(props.intl.locale)}
                                imgSrc={subtractIcon}
                                title={props.intl.formatMessage(messages.subtract)}
                                onClick={props.onSubtractShapes}
                            />
                            <LabeledIconButton
                                disabled={booleanDisabled}
                                hideLabel={hideLabel(props.intl.locale)}
                                imgSrc={splitIcon}
                                title={props.intl.formatMessage(messages.split)}
                                onClick={props.onSplitShapes}
                            />
                        </InputGroup>
                    </MediaQuery>
                    {/* Boolean operations — narrow screen (width <= 1549): dropdown */}
                    <MediaQuery maxWidth={1549}>
                        <InputGroup className={classNames(styles.modDashedBorder, styles.modLabeledIconHeight)}>
                            <Dropdown
                                className={styles.modUnselect}
                                enterExitTransitionDurationMs={20}
                                popoverContent={
                                    <InputGroup className={styles.modContextMenu}>
                                        <Button
                                            className={classNames(styles.modMenuItem, {
                                                [styles.modDisabled]: booleanDisabled
                                            })}
                                            disabled={booleanDisabled}
                                            onClick={props.onUniteShapes}
                                        >
                                            <TWRenderRecoloredImage
                                                className={styles.menuItemIcon}
                                                draggable={false}
                                                src={uniteIcon}
                                            />
                                            <span>{props.intl.formatMessage(messages.unite)}</span>
                                        </Button>
                                        <Button
                                            className={classNames(styles.modMenuItem, {
                                                [styles.modDisabled]: booleanDisabled
                                            })}
                                            disabled={booleanDisabled}
                                            onClick={props.onIntersectShapes}
                                        >
                                            <TWRenderRecoloredImage
                                                className={styles.menuItemIcon}
                                                draggable={false}
                                                src={intersectIcon}
                                            />
                                            <span>{props.intl.formatMessage(messages.intersect)}</span>
                                        </Button>
                                        <Button
                                            className={classNames(styles.modMenuItem, {
                                                [styles.modDisabled]: booleanDisabled
                                            })}
                                            disabled={booleanDisabled}
                                            onClick={props.onSubtractShapes}
                                        >
                                            <TWRenderRecoloredImage
                                                className={styles.menuItemIcon}
                                                draggable={false}
                                                src={subtractIcon}
                                            />
                                            <span>{props.intl.formatMessage(messages.subtract)}</span>
                                        </Button>
                                        <Button
                                            className={classNames(styles.modMenuItem, {
                                                [styles.modDisabled]: booleanDisabled
                                            })}
                                            disabled={booleanDisabled}
                                            onClick={props.onSplitShapes}
                                        >
                                            <TWRenderRecoloredImage
                                                className={styles.menuItemIcon}
                                                draggable={false}
                                                src={splitIcon}
                                            />
                                            <span>{props.intl.formatMessage(messages.split)}</span>
                                        </Button>
                                    </InputGroup>
                                }
                                tipSize={.01}
                            >
                                {props.intl.formatMessage(messages.boolean)}
                            </Dropdown>
                        </InputGroup>
                    </MediaQuery>
                </div>
            );
        }
        case Modes.BIT_TEXT:
        /* falls through */
        case Modes.TEXT:
            return (
                <div className={classNames(props.className, styles.modeTools)}>
                    <InputGroup>
                        <FontDropdown
                            onUpdateImage={props.onUpdateImage}
                            onManageFonts={props.onManageFonts}
                        />
                    </InputGroup>
                </div>
            );
        case Modes.BIT_RECT:
        /* falls through */
        case Modes.BIT_OVAL:
            {
                const fillIcon = props.mode === Modes.BIT_RECT ? bitRectIcon : bitOvalIcon;
                const outlineIcon = props.mode === Modes.BIT_RECT ? bitRectOutlinedIcon : bitOvalOutlinedIcon;
                return (
                    <div className={classNames(props.className, styles.modeTools)}>
                        <InputGroup>
                            <LabeledIconButton
                                highlighted={props.fillBitmapShapes}
                                imgSrc={fillIcon}
                                title={props.intl.formatMessage(messages.filled)}
                                onClick={props.onFillShapes}
                                gray
                            />
                        </InputGroup>
                        <InputGroup>
                            <LabeledIconButton
                                highlighted={!props.fillBitmapShapes}
                                imgSrc={outlineIcon}
                                title={props.intl.formatMessage(messages.outlined)}
                                onClick={props.onOutlineShapes}
                                gray
                            />
                        </InputGroup>
                        {props.fillBitmapShapes ? null : (
                            <InputGroup>
                                <Label text={props.intl.formatMessage(messages.thickness)}>
                                    <LiveInput
                                        range
                                        small
                                        max={MAX_STROKE_WIDTH}
                                        min="1"
                                        type="number"
                                        value={props.bitBrushSize}
                                        onSubmit={props.onBitBrushSliderChange}
                                    />
                                </Label>
                            </InputGroup>)
                        }
                        <InputGroup>
                            <LabeledIconButton
                                highlighted={props.proportional}
                                imgSrc={proportionalIcon}
                                title={props.intl.formatMessage(messages.proportional)}
                                onClick={props.onToggleProportional}
                            />
                        </InputGroup>
                    </div>
                );
            }
        case Modes.ROUNDED_RECT:
            {
                return (
                    <div className={classNames(props.className, styles.modeTools)}>
                        <InputGroup>
                            <div>
                                <img
                                    alt={props.intl.formatMessage(messages.cornerRadius)}
                                    className={styles.modeToolsIcon}
                                    draggable={false}
                                    src={roundIcon}
                                />
                            </div>
                            <LiveInput
                                range
                                small
                                max="100"
                                min="0"
                                type="number"
                                value={props.cornerRadius}
                                onSubmit={props.onCornerRadiusChange}
                            />
                        </InputGroup>
                        <InputGroup>
                            <LabeledIconButton
                                highlighted={props.proportional}
                                imgSrc={proportionalIcon}
                                title={props.intl.formatMessage(messages.proportional)}
                                onClick={props.onToggleProportional}
                            />
                        </InputGroup>
                    </div>
                );
            }
        case Modes.RECT:
        case Modes.OVAL:
            {
                return (
                    <div className={classNames(props.className, styles.modeTools)}>
                        <InputGroup>
                            <LabeledIconButton
                                highlighted={props.proportional}
                                imgSrc={proportionalIcon}
                                title={props.intl.formatMessage(messages.proportional)}
                                onClick={props.onToggleProportional}
                            />
                        </InputGroup>
                    </div>
                );
            }
        default:
            // Leave empty for now, if mode not supported
            return (
                <div className={classNames(props.className, styles.modeTools)} />
            );
    }
};

ModeToolsComponent.propTypes = {
    bitBrushSize: PropTypes.number,
    bitEraserSize: PropTypes.number,
    brushValue: PropTypes.number,
    className: PropTypes.string,
    clipboardItems: PropTypes.arrayOf(PropTypes.array),
    cornerRadius: PropTypes.number,
    eraserValue: PropTypes.number,
    fillBitmapShapes: PropTypes.bool,
    format: PropTypes.oneOf(Object.keys(Formats)),
    hasSelectedUncurvedPoints: PropTypes.bool,
    hasSelectedUnpointedPoints: PropTypes.bool,
    intl: intlShape.isRequired,
    mode: PropTypes.string.isRequired,
    onBitBrushSliderChange: PropTypes.func.isRequired,
    onBitEraserSliderChange: PropTypes.func.isRequired,
    onBrushSliderChange: PropTypes.func.isRequired,
    onCornerRadiusChange: PropTypes.func.isRequired,
    onCopyToClipboard: PropTypes.func.isRequired,
    onCurvePoints: PropTypes.func.isRequired,
    onDelete: PropTypes.func.isRequired,
    onEraserSliderChange: PropTypes.func,
    onFillShapes: PropTypes.func.isRequired,
    onFlipHorizontal: PropTypes.func.isRequired,
    onFlipVertical: PropTypes.func.isRequired,
    onIntersectShapes: PropTypes.func.isRequired,
    onManageFonts: PropTypes.func,
    onOutlineShapes: PropTypes.func.isRequired,
    onPasteFromClipboard: PropTypes.func.isRequired,
    onPointPoints: PropTypes.func.isRequired,
    onRotationChange: PropTypes.func.isRequired,
    onSplitShapes: PropTypes.func.isRequired,
    onSubtractShapes: PropTypes.func.isRequired,
    onToggleProportional: PropTypes.func.isRequired,
    onUniteShapes: PropTypes.func.isRequired,
    onUpdateImage: PropTypes.func.isRequired,
    proportional: PropTypes.bool,
    rotation: PropTypes.number,
    selectedItems: PropTypes.array
};

const mapStateToProps = state => ({
    mode: state.scratchPaint.mode,
    format: state.scratchPaint.format,
    fillBitmapShapes: state.scratchPaint.fillBitmapShapes,
    bitBrushSize: state.scratchPaint.bitBrushSize,
    bitEraserSize: state.scratchPaint.bitEraserSize,
    brushValue: state.scratchPaint.brushMode.brushSize,
    clipboardItems: state.scratchPaint.clipboard.items,
    eraserValue: state.scratchPaint.eraserMode.brushSize,
    cornerRadius: state.scratchPaint.roundedRectMode.cornerRadius,
    proportional: state.scratchPaint.proportionalShape,
    selectedItems: state.scratchPaint.selectedItems || []
});
const mapDispatchToProps = dispatch => ({
    onBrushSliderChange: brushSize => {
        dispatch(changeBrushSize(brushSize));
    },
    onBitBrushSliderChange: bitBrushSize => {
        dispatch(changeBitBrushSize(bitBrushSize));
    },
    onBitEraserSliderChange: eraserSize => {
        dispatch(changeBitEraserSize(eraserSize));
    },
    onEraserSliderChange: eraserSize => {
        dispatch(changeEraserSize(eraserSize));
    },
    onCornerRadiusChange: cornerRadius => {
        dispatch(changeCornerRadius(cornerRadius));
    },
    onFillShapes: () => {
        dispatch(setShapesFilled(true));
    },
    onOutlineShapes: () => {
        dispatch(setShapesFilled(false));
    },
    onToggleProportional: () => {
        dispatch(toggleProportionalShape());
    }
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(injectIntl(ModeToolsComponent));
