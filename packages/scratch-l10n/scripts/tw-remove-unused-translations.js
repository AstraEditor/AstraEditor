const strings = require('./tw-all-ids.json');

const removeUnusedTranslations = langData => {
    let result = {};
    for (const key of Object.keys(langData)) {
        if (strings.includes(key)) {
            result[key] = langData[key];
        }
    }
    return result;
};

export default removeUnusedTranslations;
