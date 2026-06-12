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
        this._unknownOpcode = unknownOpcode;
        
        this.jsonInit({
            "message0": Blockly.Msg.ERROR_UNKNOWN_OPCODE,
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
    },

    /**
     * Adapt this block to the connection context where the unknown block appears.
     * @param {'statement'|'value'} shape Shape to use for the fallback block.
     * @param {?(string|Array.<string>)} optCheck Expected value type.
     * @this Blockly.Block
     */
    setUnknownOpcodeShape: function(shape, optCheck) {
        if (shape === 'value') {
            this.setPreviousStatement(false);
            this.setNextStatement(false);
            this.setInputsInline(true);
            this.setOutputShape(
                optCheck && optCheck.indexOf &&
                    optCheck.indexOf('Boolean') !== -1 ?
                    Blockly.OUTPUT_SHAPE_HEXAGONAL :
                    Blockly.OUTPUT_SHAPE_ROUND
            );
            this.setOutput(true, optCheck || null);
            return;
        }

        this.setOutput(false);
        this.setPreviousStatement(true, null);
        this.setNextStatement(true, null);
        this.setInputsInline(true);
    },

    /**
     * Add a placeholder input so nested blocks connected to an unknown opcode are
     * still visible and attached to the fallback block.
     * @param {string} name Input name from XML.
     * @param {'statement'|'value'} inputType Input kind.
     * @param {?(string|Array.<string>)} optCheck Expected value type.
     * @this Blockly.Block
     */
    appendUnknownOpcodeInput: function(name, inputType, optCheck) {
        if (!name || this.getInput(name)) return;

        var input = inputType === 'statement' ?
            this.appendStatementInput(name) :
            this.appendValueInput(name);
        if (input.connection && optCheck) {
            input.connection.setCheck(optCheck);
        }
        input.appendField(name);
    },

    /**
     * Add a placeholder field so field-only unknown blocks expose their stored
     * values instead of collapsing to just the opcode text.
     * @param {string} name Field name from XML.
     * @param {string} value Field value from XML.
     * @this Blockly.Block
     */
    appendUnknownOpcodeField: function(name, value) {
        if (!name || this.getField(name)) return;

        this.appendDummyInput('FIELD_' + name)
            .appendField(name + ':')
            .appendField(value || '', name);
    }
};
