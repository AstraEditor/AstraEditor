const fs = require('fs');
const pathUtil = require('path');
const {uploadResource} = require('./tw-transifex');

const inputDirectory = pathUtil.join(__dirname, '../in');
if (!fs.existsSync(inputDirectory)) fs.mkdirSync(inputDirectory);

const makeTranslation = (sourceString, description) => ({
    string: sourceString,
    // We used to only set context and not developer_comment, however Transifex puts developer_comment
    // in a much more visible spot to translators, so we'd rather use that.
    // However we also keep setting context so that old translations don't get reset.
    context: description,
    developer_comment: description
});

const getAllFiles = (directory) => {
    const children = fs.readdirSync(directory);
    const result = [];
    for (const name of children) {
        const path = pathUtil.join(directory, name);
        const stat = fs.statSync(path);
        if (stat.isDirectory()) {
            const directoryChildren = getAllFiles(path);
            for (const childName of directoryChildren) {
                result.push(pathUtil.join(name, childName));
            }
        } else {
            result.push(name);
        }
    }
    return result;
};

const readMessages = (path) => {
    const content = fs.readFileSync(path, {encoding: 'utf8'});
    const parsedMessages = JSON.parse(content);
    return parsedMessages;
};

const parseGUIMessages = () => {
    const messageFiles = getAllFiles(inputDirectory).filter((file) => file.endsWith('.json'));
    const messages = {};
    const allIds = [];

    for (const file of messageFiles) {
        const path = pathUtil.join(inputDirectory, file);
        const processed = readMessages(path);

        for (const message of processed) {
            const {id, defaultMessage, description} = message;
            allIds.push(id);
            if (!id.startsWith('tw.')) {
                continue;
            }
            messages[id] = makeTranslation(defaultMessage, description);
        }
    }

    return {messages, allIds};
};

const parseBlocksMessages = () => {
    const path = pathUtil.join(inputDirectory, 'tw.js');
    const messages = {};
    const content = fs.readFileSync(path).toString();
    const matches = content.match(/formatMessage\({[\s\S]+?}/g);
    for (const match of matches) {
        const json = match.match(/{[\s\S]+?}/)[0];
        // I hate this.
        const parsedMessage = eval(`(${json})`);
        const {id, default: def, description} = parsedMessage;
        messages[id] = makeTranslation(def, description);
    }
    return messages;
};

const hardcodedMessages = {
    'tw.blocks.openDocs': makeTranslation('Open Documentation', 'Button to open extensions docsURI')
};

const guiMessages = parseGUIMessages();

const guijson = {
    ...guiMessages.messages,
    ...parseBlocksMessages(),
    ...hardcodedMessages
};

fs.writeFileSync(pathUtil.resolve(__dirname, 'tw-all-ids.json'), JSON.stringify(guiMessages.allIds));

uploadResource('guijson', guijson)
    .then((response) => {
        console.log(response);
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
