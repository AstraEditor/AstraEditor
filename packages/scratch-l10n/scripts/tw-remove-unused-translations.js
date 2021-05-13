const OMIT = [
    /^gui\.howtos\./,
    /^gui\.cards/,
    /^gui\.loader\.message/,
    /^gui\.comingSoon/,
    'gui.gui.defaultProjectTitle',
    'gui.tipsLibrary.tutorials',
    'gui.crashMessage.label',
    'gui.crashMessage.description',
    'gui.webglModal.back',
    'gui.webglModal.description',
    'gui.webglModal.previewfaq',
    'gui.webglModal.previewfaqlinktext'
].map(i => {
    if (typeof i === 'string') return new RegExp(`^${i.replace(/\./g, '\\.')}$`);
    return i;
});

const removeUnusedTranslations = langData => {
    let result = {};
    for (const key of Object.keys(langData)) {
        if (!OMIT.some(i => i.test(key))) {
            result[key] = langData[key];
        }
    }
    return result;
};

export default removeUnusedTranslations;
