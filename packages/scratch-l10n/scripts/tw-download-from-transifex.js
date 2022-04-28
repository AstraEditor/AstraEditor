import fs from 'fs';
import pathUtil from 'path';
import Limiter from 'async-limiter';
import supportedLocales from '../src/supported-locales';
import {getTranslation, getResourceLanguages} from './tw-transifex';

const SOURCE_LANGUAGE = 'en';

const scratchGuiPath = pathUtil.resolve(__dirname, '../../scratch-gui');
const desktopPath = pathUtil.resolve(__dirname, '../../turbowarp-desktop');
const packagerPath = pathUtil.resolve(__dirname, '../../packager/src/locales');

const outputDirectory = pathUtil.join(__dirname, '../out');
if (!fs.existsSync(outputDirectory)) fs.mkdirSync(outputDirectory);

const limiterDone = (limiter) => new Promise((resolve, reject) => {
    limiter.onDone(() => {
        resolve();
    });
});

const simplifyMessages = (messages, source) => {
    const result = {};
    for (const id of Object.keys(messages).sort()) {
        const value = messages[id];
        if (value) {
            if (typeof value === 'string') {
                result[id] = value;
            } else if (typeof value.string === 'string') {
                const old = source[id] && source[id].string;
                if (value.string && (value.string !== old || !old)) {
                    result[id] = value.string;
                }
            } else {
                const simplified = simplifyMessages(value, source[id]);
                if (Object.keys(simplified).length) {
                    result[id] = simplified;
                }
            }
        }
    }
    return result;
};

const processTranslations = (obj) => {
    const result = {};
    for (const key of Object.keys(obj).sort()) {
        const newKey = key.replace('_', '-').toLowerCase();
        result[newKey] = obj[key];
    }
    return result;
};

const downloadAllLanguages = async (resource) => {
    const result = {};
    const source = await getTranslation(resource, SOURCE_LANGUAGE);
    const languages = await getResourceLanguages(resource);

    const limiter = new Limiter({
        concurrency: 5
    });
    for (const language of languages) {
        limiter.push(async (callback) => {
            const translations = await getTranslation(resource, language);
            result[language] = simplifyMessages(translations, source);
            callback();
        });
    }
    await limiterDone(limiter);

    return processTranslations(result);
};

const writeToOutFile = (file, json) => {
    const path = pathUtil.join(outputDirectory, file);
    fs.writeFileSync(path, JSON.stringify(json, null, 4));
};

const processGUI = (translations) => {
    translations['es-419'] = translations.es;
    translations['pt-br'] = translations.pt;
    writeToOutFile('gui.json', translations);
    for (const lang of Object.keys(translations)) {
        if (!/^[a-z0-9_-]+$/i.test(lang)) throw new Error('invalid lang?');
        const path = pathUtil.join(__dirname, '..', 'editor', 'tw', `${lang}.json`);
        fs.mkdirSync(pathUtil.dirname(path), {recursive: true});
        fs.writeFileSync(path, JSON.stringify(translations[lang], null, 4));
    }
    writeToOutFile('gui.json', translations);
};

const processAddons = (translations) => {
    writeToOutFile('addons.json', translations);
    if (fs.existsSync(scratchGuiPath)) {
        console.log('Updating addons.json');
        fs.writeFileSync(pathUtil.join(scratchGuiPath, 'src/addons/settings/translations.json'), JSON.stringify(translations, null, 4));
    }
};

const semiPrettyPrintJSON = (json) => {
    let result = '{\n';
    for (const key of Object.keys(json)) {
        result += `${JSON.stringify(key)}:${JSON.stringify(json[key])},\n`;
    }
    result += '}';
    return result;
};

const countPropertiesRecursive = obj => {
    let count = 0;
    for (const value of Object.values(obj)) {
        if (typeof value === 'object') {
            count += countPropertiesRecursive(value);
        } else {
            count++;
        }
    }
    return count;
};

const removeStubs = (translations, minLength) => {
    const result = {};
    for (const [key, value] of Object.entries(translations)) {
        if (countPropertiesRecursive(value) >= minLength) {
            result[key] = value;
        }
    }
    return result;
};

const processDesktop = (translations) => {
    writeToOutFile('desktop.json', translations);
    if (fs.existsSync(desktopPath)) {
        console.log('Updating desktop.json');
        fs.writeFileSync(pathUtil.join(desktopPath, 'src/l10n/translations.json'), JSON.stringify(translations, null, 4));
    }
};

const processDesktopWeb = (translations) => {
    translations = removeStubs(translations, 15);
    writeToOutFile('desktop-web.json', translations);
    if (fs.existsSync(desktopPath)) {
        const index = pathUtil.join(desktopPath, 'docs/index.html');
        const oldContent = fs.readFileSync(index, 'utf-8');
        const newContent = oldContent.replace(/\/\*===\*\/[\s\S]+\/\*===\*\//m, `/*===*/${semiPrettyPrintJSON(translations)}/*===*/`);
        if (newContent !== oldContent) {
            console.log('Updating desktop-web.json');
            fs.writeFileSync(index, newContent);
        }
    }
};

const processPackager = (translations) => {
    translations = removeStubs(translations, 50);
    writeToOutFile('packager.json', translations);
    if (fs.existsSync(packagerPath)) {
        console.log('Updating packager.json');
        for (const key of Object.keys(translations)) {
            const path = pathUtil.join(packagerPath, key + '.json');
            const data = JSON.stringify(translations[key], null, 4);
            fs.writeFileSync(path, data);
        }
        const index = pathUtil.join(packagerPath, 'index.js');
        const oldContent = fs.readFileSync(index, 'utf-8');
        const newContent = oldContent.replace(/\/\*===\*\/[\s\S]+\/\*===\*\//m, `/*===*/\n${
            Object.keys(translations)
                .map(i => `  ${JSON.stringify(i)}: () => require(${JSON.stringify(`./${i}.json`)})`)
                .join(',\n')
        },\n  /*===*/`);
        fs.writeFileSync(index, newContent);

        const localeNames = {};
        for (const code of Object.keys(supportedLocales)) {
            localeNames[code] = supportedLocales[code].name;
        }
        fs.writeFileSync(
            pathUtil.join(packagerPath, 'locale-names.json'),
            JSON.stringify(localeNames, null, 4)
        );
    }
};

(async () => {
    const [
        guiMessages,
        addonMessages,
        desktopMessages,
        desktopWebMessages,
        packagerMessages
    ] = await Promise.all([
        downloadAllLanguages('guijson'),
        downloadAllLanguages('addonsjson'),
        downloadAllLanguages('desktopjson'),
        downloadAllLanguages('desktop-webjson'),
        downloadAllLanguages('packagerjson')
    ]);

    processGUI(guiMessages);
    processAddons(addonMessages);
    processDesktop(desktopMessages);
    processDesktopWeb(desktopWebMessages);
    processPackager(packagerMessages);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
