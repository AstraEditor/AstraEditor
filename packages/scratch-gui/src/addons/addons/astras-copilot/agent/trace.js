const MAX_PREVIEW_LENGTH = 1200;

/**
 * Build a short JSON preview of a tool result for the activity panel.
 * @param {*} result Tool result.
 * @param {string} [name] Tool name.
 * @returns {string} Preview text.
 */
export const previewToolResult = (result, name) => {
  let value = result;
  if (name === 'get_extension_source' && result && typeof result === 'object' && result.source) {
    value = {
      ...result,
      source: `[${result.source.length} characters of source code]`
    };
  }
  if (name === 'fetch_url' && result && typeof result === 'object' && typeof result.text === 'string') {
    value = {
      ...result,
      text: `[${result.text.length} characters of text]`
    };
  }

  let text = '';
  try {
    text = JSON.stringify(value);
  } catch (error) {
    text = String(value);
  }
  if (!text) return '';
  return text.length > MAX_PREVIEW_LENGTH ? `${text.slice(0, MAX_PREVIEW_LENGTH)}...` : text;
};

/**
 * Describe what a tool returned in a form the UI can localize.
 * @param {string} name Tool name.
 * @param {object} args Tool arguments.
 * @param {object} result Tool result.
 * @param {boolean} ok Whether the call succeeded.
 * @returns {object|null} Trace descriptor.
 */
export const describeToolResult = (name, args, result, ok) => {
  if (!ok) {
    return {
      kind: 'error',
      message: result && result.error ? result.error : 'Unknown error'
    };
  }
  if (!result || typeof result !== 'object') return null;

  switch (name) {
    case 'get_project_summary':
      return {
        kind: 'project-summary',
        sprites: Array.isArray(result.sprites) ? result.sprites.length : 0
      };
    case 'list_targets':
      return {
        kind: 'target-list',
        count: Array.isArray(result.targets) ? result.targets.length : 0
      };
    case 'get_target':
      return {
        kind: 'target',
        name: result.name || '',
        scripts: result.scriptCount || 0,
        blocks: result.blockCount || 0
      };
    case 'list_scripts':
      return {
        kind: 'script-list',
        name: (result.target && result.target.name) || '',
        count: result.count || 0
      };
    case 'get_script':
      return {
        kind: 'script',
        name: (result.target && result.target.name) || '',
        script: (result.root && result.root.label) || '',
        blocks: result.blockCount || 0
      };
    case 'search_blocks':
      return {
        kind: 'search',
        query: result.query || '',
        count: Array.isArray(result.matches) ? result.matches.length : 0
      };
    case 'get_extension_source':
      return {
        kind: 'extension',
        name: result.name || result.id || '',
        blocks: result.blockCount || 0,
        hasSource: Boolean(result.source)
      };
    case 'get_runtime_state':
      return {
        kind: 'runtime',
        running: Boolean(result.isRunning),
        threads: result.threadCount || 0
      };
    case 'search_web':
      return {
        kind: 'web-search',
        query: String(result.query || ''),
        count: Array.isArray(result.results) ? result.results.length : 0
      };
    case 'fetch_url':
      return {
        kind: 'page',
        url: String(result.url || ''),
        chars: Number(result.chars) || 0
      };
    case 'apply_scripts':
      return {
        kind: 'apply-scripts',
        name: (result.target && result.target.name) || '',
        scripts: result.scripts || 0
      };
    case 'delete_scripts':
      return {
        kind: 'delete-scripts',
        name: (result.target && result.target.name) || '',
        count: result.deleted || 0
      };
    case 'create_variable':
      return {
        kind: 'create-variable',
        name: result.name || '',
        variableKind: result.kind || 'variable',
        created: Boolean(result.created)
      };
    case 'rename_target':
      return {
        kind: 'rename-target',
        before: result.before || '',
        after: result.after || ''
      };
    case 'block_catalog':
      return {
        kind: 'block-catalog',
        count: result.count || 0
      };
    default:
      return null;
  }
};
