/* eslint-disable import/no-commonjs */

const OLD_PRIMARY_COLOR = '#855cd6';
const OLD_LIGHT_COLOR = '#A384E0';

const loader = (source) => `
    const original = ${JSON.stringify(source)};

    const getSRC = () => {
        const recolored = typeof Recolor === 'object' ? (
            original
                .replace(/${OLD_PRIMARY_COLOR}/gi, Recolor.primary)
                .replace(/${OLD_LIGHT_COLOR}/gi, Recolor.primaryLight || Recolor.primary)
        ) : original;
        return 'data:image/svg+xml;,' + encodeURIComponent(recolored);
    };

    export default getSRC;
`;

module.exports = loader;
