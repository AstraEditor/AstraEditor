import { parsePythonFunctions } from './python-parser';

const toCamelCase = (str) => {
  return str
    .split('_')
    .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join('');
};

const generateMultiFileExtension = (filesData) => {
  if (!filesData || filesData.length === 0) {
    return null;
  }

  const allBlocks = [];
  const allMethods = [];
  const allPythonCode = [];
  const fileLabels = [];

  allBlocks.push({
    opcode: 'initPython',
    blockType: 'command',
    text: 'init python',
    arguments: {}
  });

  allBlocks.push({
    opcode: 'initSuccess',
    blockType: 'boolean',
    text: 'init success?',
    arguments: {}
  });

  allBlocks.push({
    opcode: 'initLoading',
    blockType: 'boolean',
    text: 'init loading?',
    arguments: {}
  });

  allBlocks.push({
    opcode: 'runPython',
    blockType: 'command',
    text: 'run python [CODE]',
    arguments: {
      CODE: {
        type: 'string',
        defaultValue: 'print("Hello")'
      }
    }
  });

  allBlocks.push({
    opcode: 'evalPython',
    blockType: 'reporter',
    text: 'eval python [EXPR]',
    arguments: {
      EXPR: {
        type: 'string',
        defaultValue: '1 + 2'
      }
    }
  });

  allBlocks.push({
    opcode: 'getFileContent',
    blockType: 'reporter',
    text: 'file [NAME]',
    arguments: {
      NAME: {
        type: 'string',
        menu: 'fileMenu',
        defaultValue: 'extension.py'
      }
    }
  });

  allMethods.push({
    opcode: 'initPython',
    isInitBlock: true
  });

  allMethods.push({
    opcode: 'initSuccess',
    isStatusBlock: true,
    statusType: 'success'
  });

  allMethods.push({
    opcode: 'initLoading',
    isStatusBlock: true,
    statusType: 'loading'
  });

  allMethods.push({
    opcode: 'runPython',
    isRunBlock: true
  });

  allMethods.push({
    opcode: 'evalPython',
    isEvalBlock: true
  });

  allMethods.push({
    opcode: 'getFileContent',
    isFileBlock: true
  });

  filesData.forEach((fileData) => {
    const { fileName, parseResult, fullCode } = fileData;

    if (parseResult.exportedFunctions.length === 0) {
      return;
    }

    allPythonCode.push(`# File: ${fileName}\n${fullCode}`);

    const labelBlockId = `label_${toCamelCase(fileName.replace('.py', ''))}`;
    fileLabels.push({
      blockId: labelBlockId,
      labelText: fileName.replace('.py', '')
    });

    allBlocks.push({
      opcode: labelBlockId,
      blockType: 'label',
      text: fileName.replace('.py', '')
    });

    parseResult.exportedFunctions.forEach((func) => {
      const blockId = toCamelCase(func.name);
      const blockText =
        func.name +
        (func.parameters.length > 0 ? ` ${func.parameters.map((p) => `[${p.name.toUpperCase()}]`).join(' ')}` : '');

      const blockArgs = {};
      func.parameters.forEach((param) => {
        blockArgs[param.name.toUpperCase()] = {
          type: 'string',
          defaultValue: ''
        };
      });

      const argsCode = func.parameters.map((p) => `args.${p.name.toUpperCase()}`).join(', ');
      const blockType = func.returnType || 'command';

      allBlocks.push({
        opcode: blockId,
        blockType: blockType,
        text: blockText,
        arguments: blockArgs
      });

      allMethods.push({
        opcode: blockId,
        funcName: func.name,
        argsCode: argsCode,
        isPythonBlock: true
      });
    });
  });

  if (allBlocks.length === 0) {
    return null;
  }

  const blocksCode = allBlocks
    .map((b) => {
      if (b.blockType === 'label') {
        return `                {
                    opcode: '${b.opcode}',
                    blockType: Scratch.BlockType.LABEL,
                    text: '${b.text}'
                }`;
      }
      const blockTypeStr = `Scratch.BlockType.${b.blockType.toUpperCase()}`;
      return `                {
                    opcode: '${b.opcode}',
                    blockType: ${blockTypeStr},
                    text: '${b.text}',
                    arguments: ${JSON.stringify(b.arguments)}
                }`;
    })
    .join(',\n');

  const methodsCode = allMethods
    .map((m) => {
      if (m.isInitBlock) {
        return `
    ${m.opcode}(args, util) {
        if (pyodideState.loading) {
            return;
        }
        if (pyodideState.ready && pyodideState.worker) {
            pyodideState.worker.postMessage({ type: 'updateCode', data: PYTHON_CODE });
            return;
        }
        pyodideState.loading = true;
        pyodideState.ready = false;
        pyodideState.error = null;
        
        initPyodideBackground();
    }`;
      }

      if (m.isStatusBlock) {
        return `
    ${m.opcode}(args, util) {
        return ${m.statusType === 'success' ? 'pyodideState.ready === true' : 'pyodideState.loading === true'};
    }`;
      }

      if (m.isRunBlock) {
        return `
    async ${m.opcode}(args, util) {
        if (!pyodideState.ready || !pyodideState.worker) {
            console.warn('Python not initialized');
            return;
        }
        try {
            await runPythonCode(args.CODE);
        } catch (error) {
            console.error('Python run error:', error);
        }
    }`;
      }

      if (m.isEvalBlock) {
        return `
    async ${m.opcode}(args, util) {
        if (!pyodideState.ready || !pyodideState.worker) {
            console.warn('Python not initialized');
            return null;
        }
        try {
            const result = await evalPythonCode(args.EXPR);
            return result;
        } catch (error) {
            console.error('Python eval error:', error);
            return null;
        }
    }`;
      }

      if (m.isFileBlock) {
        return `
    ${m.opcode}(args, util) {
        try {
            const vm = (typeof Scratch !== 'undefined' && Scratch.vm) || null;
            if (vm && vm.runtime) {
                const metadata = vm.runtime.getProjectMetadata();
                const files = metadata && metadata.custom && metadata.custom.file;
                if (Array.isArray(files)) {
                    const file = files.find((f) => f && f.name === args.NAME);
                    if (file) {
                        return file.content || '';
                    }
                }
            }
        } catch (error) {
            console.error('Failed to read file from VM:', error);
        }
        return '';
    }`;
      }

      if (m.isPythonBlock) {
        return `
    async ${m.opcode}(args, util) {
        if (!pyodideState.ready || !pyodideState.worker) {
            console.warn('Python not initialized. Please run "init python" first.');
            return null;
        }
        try {
            const argsArray = [${m.argsCode}];
            const result = await runPythonFunction('${m.funcName}', argsArray);
            return result;
        } catch (error) {
            console.error('Python execution error in ${m.funcName}:', error);
            return null;
        }
    }`;
      }

      return '';
    })
    .join('\n');

  const combinedPythonCode = allPythonCode.join('\n\n');

  const extensionCode = `
(function() {
    const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.24.1/full/";
    const PYTHON_CODE = ${JSON.stringify(combinedPythonCode)};

    // Pyodide 运行状态归属扩展自身，不依赖 window（打包器等无 Monaco 环境同样可用）
    const pyodideState = {
        worker: null,
        ready: false,
        loading: false,
        error: null
    };

    function createPyodideWorker() {
        const workerCode = \`
            let pyodide = null;
            let pythonCode = null;

            async function loadPyodide() {
                if (pyodide) return pyodide;
                
                importScripts('https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js');
                
                pyodide = await loadPyodide({
                    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/',
                    fullStdLib: false
                });
                
                return pyodide;
            }

            self.onmessage = async function(e) {
                const { type, data } = e.data;
                
                try {
                    if (type === 'init') {
                        pythonCode = data;
                        await loadPyodide();
                        await pyodide.runPythonAsync(pythonCode);
                        self.postMessage({ type: 'ready' });
                    } else if (type === 'run') {
                        if (!pyodide) {
                            self.postMessage({ type: 'error', error: 'Pyodide not initialized' });
                            return;
                        }
                        const func = pyodide.globals.get(data.funcName);
                        if (func) {
                            const result = await func(...data.args);
                            let jsResult = result;
                            if (result && typeof result.toJs === 'function') {
                                jsResult = result.toJs();
                            }
                            self.postMessage({ type: 'result', result: jsResult });
                        } else {
                            self.postMessage({ type: 'error', error: 'Function not found: ' + data.funcName });
                        }
                    } else if (type === 'runCode') {
                        if (!pyodide) {
                            self.postMessage({ type: 'error', error: 'Pyodide not initialized' });
                            return;
                        }
                        await pyodide.runPythonAsync(data);
                        self.postMessage({ type: 'codeRun' });
                    } else if (type === 'evalCode') {
                        if (!pyodide) {
                            self.postMessage({ type: 'error', error: 'Pyodide not initialized' });
                            return;
                        }
                        const result = await pyodide.runPythonAsync(data);
                        let jsResult = result;
                        if (result && typeof result.toJs === 'function') {
                            jsResult = result.toJs();
                        }
                        self.postMessage({ type: 'evalResult', result: jsResult });
                    } else if (type === 'updateCode') {
                        pythonCode = data;
                        if (pyodide) {
                            await pyodide.runPythonAsync(pythonCode);
                            self.postMessage({ type: 'codeUpdated' });
                        }
                    }
                } catch (error) {
                    self.postMessage({ type: 'error', error: error.message || String(error) });
                }
            };
        \`;
        
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        return new Worker(URL.createObjectURL(blob));
    }

    function initPyodideBackground() {
        if (pyodideState.worker) {
            pyodideState.worker.postMessage({ type: 'updateCode', data: PYTHON_CODE });
            return;
        }

        pyodideState.worker = createPyodideWorker();
        pyodideState.worker.onmessage = function(e) {
            const { type, result, error } = e.data;
            if (type === 'ready') {
                pyodideState.ready = true;
                pyodideState.loading = false;
                console.log('[Pyodide] Loaded in background worker!');
            } else if (type === 'error') {
                console.error('[Pyodide Worker Error]', error);
            }
        };
        pyodideState.worker.onerror = function(e) {
            console.error('[Pyodide Worker Error]', e.message);
            pyodideState.ready = false;
            pyodideState.loading = false;
            pyodideState.error = e.message;
        };

        pyodideState.worker.postMessage({ type: 'init', data: PYTHON_CODE });
        console.log('[Pyodide] Starting background worker...');
    }

    async function runPythonFunction(funcName, args) {
        if (!pyodideState.ready || !pyodideState.worker) {
            return null;
        }
        
        return new Promise((resolve, reject) => {
            const handler = function(e) {
                const { type, result, error } = e.data;
                if (type === 'result') {
                    pyodideState.worker.removeEventListener('message', handler);
                    resolve(result);
                } else if (type === 'error') {
                    pyodideState.worker.removeEventListener('message', handler);
                    resolve(null);
                }
            };
            pyodideState.worker.addEventListener('message', handler);
            pyodideState.worker.postMessage({ type: 'run', data: { funcName, args } });
        });
    }

    async function runPythonCode(code) {
        if (!pyodideState.ready || !pyodideState.worker) {
            return;
        }
        
        return new Promise((resolve, reject) => {
            const handler = function(e) {
                const { type, error } = e.data;
                if (type === 'codeRun') {
                    pyodideState.worker.removeEventListener('message', handler);
                    resolve();
                } else if (type === 'error') {
                    pyodideState.worker.removeEventListener('message', handler);
                    console.error('Python code error:', error);
                    resolve();
                }
            };
            pyodideState.worker.addEventListener('message', handler);
            pyodideState.worker.postMessage({ type: 'runCode', data: code });
        });
    }

    async function evalPythonCode(code) {
        if (!pyodideState.ready || !pyodideState.worker) {
            return null;
        }
        
        return new Promise((resolve, reject) => {
            const handler = function(e) {
                const { type, result, error } = e.data;
                if (type === 'evalResult') {
                    pyodideState.worker.removeEventListener('message', handler);
                    resolve(result);
                } else if (type === 'error') {
                    pyodideState.worker.removeEventListener('message', handler);
                    console.error('Python eval error:', error);
                    resolve(null);
                }
            };
            pyodideState.worker.addEventListener('message', handler);
            pyodideState.worker.postMessage({ type: 'evalCode', data: code });
        });
    }

    class PythonExtension {
        getFileMenu() {
            try {
                const vm = (typeof Scratch !== 'undefined' && Scratch.vm) || null;
                if (vm && vm.runtime) {
                    const metadata = vm.runtime.getProjectMetadata();
                    const files = metadata && metadata.custom && metadata.custom.file;
                    if (Array.isArray(files) && files.length > 0) {
                        return files.map((f) => ({ text: f.name, value: f.name }));
                    }
                }
            } catch (error) {
                console.error('Failed to read file names from VM:', error);
            }
            return [{ text: 'extension.py', value: 'extension.py' }];
        }

        getInfo() {
            return {
                id: 'pythonBlocks',
                name: 'Python',
                color1: '#66ccff',
                color2: '#55aadd',
                color3: '#4499cc',
                blocks: [
${blocksCode}
                ],
                menus: {
                    fileMenu: {
                        acceptReporters: false,
                        items: 'getFileMenu'
                    }
                }
            };
        }
${methodsCode}
    }

    Scratch.extensions.register(new PythonExtension());
})();
`;

  const totalBlocks = allBlocks.filter((b) => b.blockType !== 'label').length;

  return {
    extensionId: 'pythonBlocks',
    extensionCode,
    blockCount: totalBlocks,
    fileCount: filesData.length,
    fileNames: filesData.map((f) => f.fileName)
  };
};

const generateExtensionFromFiles = (files) => {
  const filesData = [];

  for (const file of files) {
    if (!file.content || !file.name.endsWith('.py')) {
      continue;
    }

    const parseResult = parsePythonFunctions(file.content);

    if (!parseResult.hasExports || parseResult.exportedFunctions.length === 0) {
      continue;
    }

    filesData.push({
      fileName: file.name,
      parseResult,
      fullCode: file.content
    });
  }

  if (filesData.length === 0) {
    return {
      success: false,
      error: 'No valid Python files with __all__ exports found.'
    };
  }

  const extension = generateMultiFileExtension(filesData);

  if (!extension) {
    return {
      success: false,
      error: 'Failed to generate extension.'
    };
  }

  return {
    success: true,
    extension,
    filesData
  };
};

export { generateMultiFileExtension, generateExtensionFromFiles };
