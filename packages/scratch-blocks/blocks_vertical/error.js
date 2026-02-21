goog.provide('Blockly.Blocks.error');

goog.require('Blockly.Blocks');
goog.require('Blockly.Colours');
goog.require('Blockly.constants');
goog.require('Blockly.ScratchBlocks.VerticalExtensions');

/**
 * Error block for displaying unknown opcodes.
 * This block is shown when a block with an unrecognized opcode is encountered.
 */
Blockly.Blocks['error'] = {
    /**
     * Block to display unknown opcode error.
     * @this Blockly.Block
     */
    init: function() {
        // Get the unknown opcode from this.type or this._unknownOpcode
        var unknownOpcode = this.type;
        
        // If this.type is 'error', then it's a manually placed error block, not an unknown opcode
        if (unknownOpcode === 'error') {
            unknownOpcode = this._unknownOpcode || 'unknown';
        }
        
        this.jsonInit({
            "message0": "UNKNOWN OPCODE: %1",
            "args0": [
                {
                    "type": "field_label",
                    "name": "OPCODE",
                    "text": unknownOpcode
                }
            ],
            "category": Blockly.Categories.error,
            "extensions": ["colours_error", "shape_statement"]
        });
        
        // Disable the error block so it cannot be executed
        this.setDisabled(true);
    }
};