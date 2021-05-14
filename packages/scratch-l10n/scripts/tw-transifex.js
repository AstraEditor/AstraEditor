const fetch = require('node-fetch').default;
const https = require('https');
require('dotenv').config();

const API_TOKEN = process.env.TRANSIFEX_API_TOKEN;
const AUTHENTICATION = `api:${API_TOKEN}`;
const PROJECT = 'turbowarp';
const SOURCE_LANGUAGE = 'en';

// Re-use a single request agent with keepalive for performance.
const httpsAgent = new https.Agent({
    keepAlive: true
});

const fetchAPI = async (path, options = {}) => {
    const url = `https://www.transifex.com/api/2/${path}`;
    const opts = {
        ...options,
        method: options.method || 'GET',
        headers: {
            Authorization: `Basic ${Buffer.from(AUTHENTICATION).toString('base64')}`,
            ...(options.headers || {})
        },
        agent: httpsAgent
    };
    console.log(` -> ${opts.method} ${url}`);
    const response = await fetch(url, opts);
    if (response.status !== 200) {
    // console.log(response);
        console.log(await response.text());
        throw new Error(`Unexpected status code: ${response.status}`);
    }
    return await response.json();
};

const getTranslation = async (resource, language) => {
    const raw = (await fetchAPI(`project/${PROJECT}/resource/${resource}/translation/${language}?mode=onlytranslated`)).content;
    return JSON.parse(raw);
};

const getStats = async (resource) => {
    return await fetchAPI(`project/${PROJECT}/resource/${resource}/stats`);
};

const getResourceLanguages = async (resource) => {
    const stats = await getStats(resource);
    const result = [];
    for (const language of Object.keys(stats)) {
        if (stats[language].translated_words > 0 && language !== SOURCE_LANGUAGE) {
            result.push(language);
        }
    }
    result.sort();
    return result;
};

const uploadResource = async (resource, content) => {
    return await fetchAPI(`project/${PROJECT}/resource/${resource}/content`, {
        method: 'PUT',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            content: JSON.stringify(content)
        })
    });
};

module.exports = {
    SOURCE_LANGUAGE,
    getTranslation,
    getResourceLanguages,
    uploadResource
};
