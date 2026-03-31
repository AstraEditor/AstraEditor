const strings = require('./tw-all-ids.json');

const removeUnusedTranslations = langData => {
    let result = {};
    for (const key of Object.keys(langData)) {
        if (
            strings.includes(key) ||
            key.startsWith('boost.') ||
            key.startsWith('ev3.') ||
            key.startsWith('gdxfor.') ||
            key.startsWith('makeymakey.') ||
            key.startsWith('microbit.') ||
            key.startsWith('music.') ||
            key.startsWith('pen.') ||
            // key.startsWith('speech.') ||
            key.startsWith('text2speech.') ||
            key.startsWith('translate.') ||
            key.startsWith('videoSensing.') ||
            key.startsWith('wedo2.')
        ) {
            result[key] = langData[key];
        }
    }
    return result;
};

export default removeUnusedTranslations;
