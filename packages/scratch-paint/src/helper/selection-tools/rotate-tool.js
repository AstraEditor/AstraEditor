import paper from '@turbowarp/paper';
import {getGuideLayer, setGuideItem} from '../layer';

/**
 * Tool to handle rotation when dragging the rotation handle in the bounding box tool.
 */
class RotateTool {
    /**
     * @param {!function} onUpdateImage A callback to call when the image visibly changes
     */
    constructor (onUpdateImage) {
        this.rotItems = [];
        this.rotGroupPivot = null;
        this.prevRot = 90;
        this.currentRotation = 0;
        this.rotationLabel = null;
        this.onUpdateImage = onUpdateImage;
    }

    /**
     * @param {!paper.HitResult} hitResult Data about the location of the mouse click
     * @param {!object} boundsPath Where the boundaries of the hit item are
     * @param {!Array.<paper.Item>} selectedItems Set of selected paper.Items
     */
    onMouseDown (hitResult, boundsPath, selectedItems) {
        this.rotItems.length = 0;
        this.rotGroupPivot = boundsPath.bounds.center;
        for (const item of selectedItems) {
            // Rotate only root items
            if (item.parent instanceof paper.Layer) {
                this.rotItems.push(item);
            }
        }
        this.prevRot = 90;
        this.currentRotation = 0;
        this._createRotationLabel();
    }
    onMouseDrag (event) {
        let rotAngle = (event.point.subtract(this.rotGroupPivot)).angle;
        if (event.modifiers.shift) {
            rotAngle = Math.round(rotAngle / 45) * 45;
        }
        const deltaRotation = rotAngle - this.prevRot;

        for (let i = 0; i < this.rotItems.length; i++) {
            const item = this.rotItems[i];

            item.rotate(deltaRotation, this.rotGroupPivot);
        }

        this.currentRotation += deltaRotation;
        this._updateRotationLabel();
        this.prevRot = rotAngle;
    }
    onMouseUp (event) {
        if (event.event.button > 0) return; // only first mouse button

        this.rotItems.length = 0;
        this.rotGroupPivot = null;
        this.prevRot = 90;
        this.currentRotation = 0;
        this._removeRotationLabel();

        this.onUpdateImage();
    }
    _createRotationLabel () {
        this._removeRotationLabel();

        this.rotationLabel = new paper.PointText({
            content: '0°',
            fillColor: "#0099ff",
            strokeColor: new paper.Color(1, 1, 1, 0.8),
            justification: 'center',
            fontWeight: 'bold',
            data: {
                isHelperItem: true,
                noSelect: true,
                noHover: true
            }
        });
        setGuideItem(this.rotationLabel);
        this.rotationLabel.parent = getGuideLayer();
        this._updateRotationLabel();
    }
    _updateRotationLabel () {
        if (!this.rotationLabel || !this.rotGroupPivot) return;

        let angle = Math.round(this.currentRotation);
        if (Object.is(angle, -0)) {
            angle = 0;
        }

        this.rotationLabel.content = `${angle}°`;
        this.rotationLabel.fontSize = 36 / paper.view.zoom;
        this.rotationLabel.strokeWidth = 1 / paper.view.zoom;
        this.rotationLabel.position = this.rotGroupPivot;
        this.rotationLabel.bringToFront();
    }
    _removeRotationLabel () {
        if (!this.rotationLabel) return;

        this.rotationLabel.remove();
        this.rotationLabel = null;
    }
}

export default RotateTool;
