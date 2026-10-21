import classNames from 'classnames';
import PropTypes from 'prop-types';
import React, { useState, useEffect, useRef } from 'react';
import { defineMessages, injectIntl, intlShape, FormattedMessage } from 'react-intl';

import add from './add.svg';
import custom from './custom.svg';
import code from './code.svg';
import Modal from '../../containers/modal.jsx';
import Box from '../box/box.jsx';
import AddonHooks from '../../addons/hooks';
import extensionTags from '../../lib/libraries/tw-extension-tags';

import FileIcon from './file.svg';
import WebsiteIcon from './website.svg';
import BuiltInIcon from './builtin.svg';

import styles from './extension-chooser.css';

import { openPreviewExt } from '../../reducers/modals';
import { setPreviewExtData } from '../../reducers/ae-preview-ext-data';

const messages = defineMessages({
  extensionChooserTitle: {
    defaultMessage: 'Extension Manager',
    description: 'Heading for the extension manager modal',
    id: 'tw.extensionManager.title'
  },
  openLibraryButton: {
    defaultMessage: 'Open Extension Library',
    description: 'Button to open the original extension library',
    id: 'tw.extensionManager.openLibrary'
  },
  byInternet: {
    defaultMessage: 'Loaded from Internet',
    id: 'tw.extensionManager.byInternet'
  },
  byLocal: {
    defaultMessage: 'Loaded from Local',
    id: 'tw.extensionManager.byLocal'
  },
  byBuiltIn: {
    defaultMessage: 'Built-in Extension',
    id: 'tw.extensionManager.byBuiltIn'
  },
  dropOnlyJS: {
    defaultMessage: 'Only .js extension files can be loaded by dragging them here.',
    description: 'Shown when files other than JavaScript extension files are dropped on the extension manager',
    id: 'tw.extensionManager.dropOnlyJS'
  }
});

const toResolvedAssetURL = (baseURL, assetPath) => {
  if (!assetPath || typeof assetPath !== 'string') {
    return null;
  }
  if (/^\/\//.test(assetPath)) {
    return `https:${assetPath}`;
  }
  if (/^(?:https?:|data:|blob:|file:)/i.test(assetPath)) {
    return assetPath;
  }
  if (!baseURL) {
    return assetPath;
  }
  const normalizedBaseURL = String(baseURL).replace(/\/+$/, '');
  const normalizedAssetPath = assetPath.replace(/^\/+/, '');
  return `${normalizedBaseURL}/${normalizedAssetPath}`;
};

const ExtensionImage = ({ src, alt, style, fallbackSrc, onLoad }) => {
  const [imageError, setImageError] = useState(false);
  const [loading, setLoading] = useState(true);

  const handleError = () => {
    setImageError(true);
    setLoading(false);
  };

  const handleLoad = () => {
    setLoading(false);
    if (onLoad) {
      onLoad();
    }
  };

  if (imageError || !src) {
    return null;
  }

  return <img src={src} alt={alt} style={style} onError={handleError} onLoad={handleLoad} />;
};

ExtensionImage.propTypes = {
  src: PropTypes.string,
  alt: PropTypes.string,
  style: PropTypes.object,
  fallbackSrc: PropTypes.string,
  onLoad: PropTypes.func
};

const ExtensionChooser = (props) => {
  const { intl, onRequestClose, onOpenExtensionLibrary, onOpenCodeLibrary, onOpenCustomExtensionModal, vm, dispatch } =
    props;
  const [extensions, setExtensions] = useState([]);
  const [updateExts, setUpdateExts] = useState(false);
  const [reloadingExtensions, setReloadingExtensions] = useState({});
  const [draggingFiles, setDraggingFiles] = useState(false);
  const isMountedRef = useRef(false);
  const dropFilesRef = useRef(null);
  const [galleryData, setGalleryData] = useState({});
  const [backgroundLoaded, setBackgroundLoaded] = useState({});
  const [search, setSearch] = useState('');
  const [extensionsURLs, setExtensionsURLs] = useState({urls: vm.extensionManager.workerURLs, exts: vm.extensionManager._loadedExtensions });
  /*
   * a-b : debugger扩展
   */
  const TurboWarp_Exts = ['a-b'];
  /**
   * SPmbpCST无法通过删除方法移除，它不仅仅是个简单扩展
   */
  const RemoveExpect_Exts = ['SPmbpCST'];
  /*
   *这里下载的文件实际上为html
   */
  const TurboWarp_IncludeExts = Object.keys(vm.extensionManager.builtinExtensions);

  /**
   * 收集已加载的扩展：已成功注册的分类，以及已加载但注册失败的扩展。
   * 失败条目带有 failed: true，用于在列表中显示“重新加载”。
   * @returns {Array<object>} 扩展条目列表
   */
  const collectLoadedExtensions = () => {
    if (!vm || !vm.runtime) return [];
    const extensionMap = new Map();
    (vm.runtime._blockInfo || []).forEach((ext) => {
      if (ext && ext.id) {
        extensionMap.set(ext.id, ext);
      }
    });

    const manager = vm.extensionManager;
    const failedExtensions =
      manager && typeof manager.getFailedExtensions === 'function'
        ? manager.getFailedExtensions()
        : (manager && manager._failedExtensions) || new Map();

    failedExtensions.forEach((error, extensionId) => {
      if (!extensionId) return;
      const existing = extensionMap.get(extensionId);
      extensionMap.set(
        extensionId,
        existing
          ? { ...existing, failed: true, failureReason: error }
          : {
              id: extensionId,
              name: extensionId,
              failed: true,
              failureReason: error,
              color1: '#cf4a4a',
              color2: '#a83232'
            }
      );
    });

    return Array.from(extensionMap.values()).filter((ext) => ext && ext.id);
  };

  /**
   * 重新加载注册失败的扩展。
   * @param {string} extensionId 扩展 ID
   * @returns {Promise<void>} 无返回值
   */
  const handleReloadExtension = async (extensionId) => {
    if (!vm || !vm.extensionManager) return;
    const manager = vm.extensionManager;
    setReloadingExtensions((prev) => ({ ...prev, [extensionId]: true }));
    try {
      const urls = typeof manager.getExtensionURLs === 'function' ? manager.getExtensionURLs() : {};
      const url = urls[extensionId] || (manager.isBuiltinExtension(extensionId) ? extensionId : null);
      if (!url) {
        throw new Error(`Cannot find the URL of extension: ${extensionId}`);
      }
      // 先清掉残留的加载 / 注册状态，再完整地重新加载一次
      if (manager.isExtensionLoaded(extensionId)) {
        manager.unloadExtension(extensionId, { skipConfirm: true });
      }
      await manager.loadExtensionURL(url);
      setExtensions(collectLoadedExtensions());
      // 块注册可能是异步完成的，稍后再刷新一次以拿到最终状态
      setTimeout(() => {
        if (isMountedRef.current) {
          setExtensions(collectLoadedExtensions());
        }
      }, 1000);
    } catch (err) {
      console.error(`Failed to reload extension: ${extensionId}`, err);
      // eslint-disable-next-line no-alert
      alert(err);
      setExtensions(collectLoadedExtensions());
    } finally {
      setReloadingExtensions((prev) => {
        const next = { ...prev };
        delete next[extensionId];
        return next;
      });
    }
  };

  /**
   * 把拖入的文件读取为 data URL，并强制使用 JavaScript MIME 类型。
   * @param {File} file 扩展文件
   * @returns {Promise<string>} data URL
   */
  const readExtensionFile = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        if (comma === -1) {
          reject(new Error(`Could not read extension file: ${file.name}`));
          return;
        }
        const isBase64 = /;base64$/i.test(result.substring(0, comma));
        resolve(`data:application/javascript${isBase64 ? ';base64' : ''},${result.substring(comma + 1)}`);
      };
      reader.onerror = () => reject(new Error(`Could not read extension file: ${file.name}`));
      reader.readAsDataURL(file);
    });

  /**
   * 加载拖入的 .js 扩展文件。加载前会通过现有的安全确认模态框询问用户。
   * @param {Array<File>} files 拖入的文件列表
   * @returns {Promise<void>} 无返回值
   */
  const handleDroppedFiles = async (files) => {
    if (!vm || !vm.extensionManager) return;

    const jsFiles = files.filter((file) => /\.js$/i.test(file.name));
    if (jsFiles.length === 0) {
      if (files.length > 0) {
        // eslint-disable-next-line no-alert
        alert(intl.formatMessage(messages.dropOnlyJS));
      }
      return;
    }

    const manager = vm.extensionManager;
    const droppedExtensions = await Promise.all(
      jsFiles.map(async (file, index) => ({
        // id 只用于确认模态框中的展示，真正加载时使用 url
        id: jsFiles.length > 1 ? `#${index + 1} ${file.name}` : file.name,
        name: file.name,
        url: await readExtensionFile(file)
      }))
    );

    // 复用现有的“加载扩展”确认模态框
    const securityManager = manager.securityManager;
    let allowed = true;
    if (securityManager && typeof securityManager.canLoadMultipleExtensionsFromProject === 'function') {
      allowed = await securityManager.canLoadMultipleExtensionsFromProject(droppedExtensions);
    } else if (securityManager && typeof securityManager.canLoadExtensionFromProject === 'function') {
      for (const extension of droppedExtensions) {
        if (!(await securityManager.canLoadExtensionFromProject(extension.id, extension.url))) {
          allowed = false;
          break;
        }
      }
    }
    if (!allowed) return;

    for (const extension of droppedExtensions) {
      try {
        await manager.loadExtensionURL(extension.url);
      } catch (err) {
        console.error(`Failed to load dropped extension: ${extension.name}`, err);
        // eslint-disable-next-line no-alert
        alert(err);
      }
    }
    setExtensions(collectLoadedExtensions());
  };

  dropFilesRef.current = handleDroppedFiles;

  // 删除扩展
  const handleRemoveExtension = (extensionId) => {
    if (!vm || !vm.extensionManager) return;

    vm.extensionManager.unloadExtension(extensionId);
  };

  const getAllDisplayExtensions = (Exts) => {
    let Total = 0;
    Exts.map((item) => {
      if (!TurboWarp_Exts.includes(item.id)) {
        Total += 1;
      }
    });
    return Total;
  };
  useEffect(() => {
    const fetchGallery = async () => {
      try {
        const getExtLists = extensionTags.map(async (item) => {
          if (item.tag === 'scratch') {
            return { id: item.tag, data: { extensions: [] }, error: false };
          }
          try {
            const res = await fetch(`${item.url}/generated-metadata/extensions-v0.json`);
            if (!res.ok) {
              return { id: item.tag, error: true };
            }
            const data = await res.json();
            return { id: item.tag, data, error: false };
          } catch (e) {
            return { id: item.tag, error: true };
          }
        });
        const results = await Promise.all(getExtLists);
        const metadataMap = {};

        results.forEach((result, index) => {
          if (result.error) {
            return;
          }

          result.data.extensions.forEach((extension) => {
            const sourceURL = extensionTags[index].url;
            metadataMap[extension.id] = {
              imageURL: toResolvedAssetURL(sourceURL, extension.image),
              iconURL: toResolvedAssetURL(sourceURL, extension.iconURL),
              sourceURL
            };
          });
        });
        setGalleryData(metadataMap);
      } catch (error) {
        console.error('Failed to fetch extension gallery:', error);
      }
    };
    fetchGallery();
  }, []);

  useEffect(() => {
    if (vm && vm.runtime && vm.runtime._blockInfo) {
      setExtensions(collectLoadedExtensions());
    }
  }, [vm, updateExts]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const hasFiles = (event) => !!event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files');

    const handleWindowDragOver = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      setDraggingFiles(true);
    };

    const handleWindowDragLeave = (event) => {
      // relatedTarget 为 null 表示已经拖出窗口
      if (event.relatedTarget === null) {
        setDraggingFiles(false);
      }
    };

    const handleWindowDrop = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDraggingFiles(false);
      const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
      if (dropFilesRef.current) {
        Promise.resolve(dropFilesRef.current(files)).catch((err) => {
          console.error('Failed to load dropped extensions:', err);
          // eslint-disable-next-line no-alert
          alert(err);
        });
      }
    };

    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('drop', handleWindowDrop);
    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, []);

  useEffect(() => {
    if (!vm || !vm.runtime) return;

    const updateInfo = () => {
      if (vm.runtime && vm.runtime._blockInfo) {
        setExtensions(collectLoadedExtensions());
        queueMicrotask(() => {
          setExtensionsURLs({ urls: vm.extensionManager.workerURLs, exts: vm.extensionManager._loadedExtensions });
        });
      }
    };

    vm.runtime.on('EXTENSION_ADDED', updateInfo);
    vm.runtime.on('EXTENSION_REMOVED', updateInfo);
    vm.runtime.on('PROJECT_CHANGED', updateInfo);
    return () => {
      vm.runtime.off('EXTENSION_ADDED', updateInfo);
      vm.runtime.off('EXTENSION_REMOVED', updateInfo);
      vm.runtime.off('PROJECT_CHANGED', updateInfo);
    };
  }, [vm]);

  // 获取扩展的背景图
  const getExtensionBackground = (item) => {
    // 对于网页扩展，从 galleryData 获取
    if (galleryData[item.id]) {
      const extData = galleryData[item.id];
      // 如果有 image 字段，使用它（这是背景图）
      if (extData.imageURL) {
        return extData.imageURL;
      }
      // 否则使用 iconURL
      if (extData.iconURL) {
        return extData.iconURL;
      }
      if (extData.sourceURL) {
        return toResolvedAssetURL(extData.sourceURL, `images/${item.id}.svg`);
      }
    }
    if (item.iconURL) {
      return toResolvedAssetURL(null, item.iconURL);
    }

    // 最后尝试使用默认路径
    return `https://extensions.turbowarp.org/images/${item.id}.svg`;
  };

  // 背景图加载成功回调
  const handleBackgroundLoad = (extensionId) => {
    setBackgroundLoaded((prev) => ({
      ...prev,
      [extensionId]: true
    }));
  };

  const handleClose = () => {
    onRequestClose();
  };

  const handleOpenCode = () => {
    onOpenCodeLibrary();
  };

  const handleOpenLibrary = () => {
    onOpenExtensionLibrary();
  };

  const handleOpenCustomExtension = () => {
    onOpenCustomExtensionModal();
  };

  const getExt = (extensionId) => {
    // 获取扩展的下载 URL
    let url = null;

    if (vm && vm.extensionManager) {
      // 检查是否是内置扩展
      if (vm.extensionManager.isBuiltinExtension(extensionId)) {
        url = `https://extensions.turbowarp.org/${extensionId}.js`;
      } else {
        // 从 getExtensionURLs 获取自定义扩展的 URL
        const urls = vm.extensionManager.getExtensionURLs();
        url = urls[extensionId];
      }
    }
    return url;
  };

  const getOpcodefromExt = (Ext) => {
    const AllOpcode = [];
    const color = Ext.color1 || '#0099ff';
    Ext.blocks.forEach((item, index) => {
      if (item.info.opcode == undefined) return;
      if (item.info.blockType == 'label') {
        AllOpcode.push({
          isSVG: true,
          data: `
                <svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
                    <g>
                        <text xml:space="preserve" text-anchor="start" font-family="Consolas, 'Courier New', monospace, 'MiSans'" font-size="24" id="svg_1" y="20" x="-380" stroke-width="0" stroke="#888" fill=${color}>
                            ${item.info.text}
                        </text>
                        <line  y2="30" x2="0" y1="30" x1="255" stroke=${color} fill="none"/>
                    </g>
                </svg>
                `
        });
        return;
      }
      AllOpcode.push(`${Ext.id}_${item.info.opcode}`); // 获取完整的opcode
    });

    return {
      AllOpcode
    };
  };

  const getSVGfromOpcodes = (Opcodes) => {
    const blocksSVG = [];
    const opcodes = Opcodes.AllOpcode;
    opcodes.forEach((item, index) => {
      try {
        if (item.isSVG) {
          blocksSVG.push(item.data);
        } else {
          const blockSVGgen = AddonHooks.blocklyWorkspace.newBlock(item);
          blockSVGgen.initSvg();
          blockSVGgen.render();
          blocksSVG.push(blockSVGgen.getSvgRoot().innerHTML);
          // 删除积木
          blockSVGgen.dispose();
        }
      } catch (e) {
        console.warn("Can't spawn blocks");
      }
    });
    console.log(blocksSVG);
    return blocksSVG;
  };
  return (
    <Modal
      fullScreen
      contentLabel={intl.formatMessage(messages.extensionChooserTitle)}
      id="extensionManager"
      onRequestClose={handleClose}
    >
      <div className={styles.container}>
        {draggingFiles && (
          <div className={styles.dropOverlay}>
            <div className={styles.dropOverlayInner}>
              <FormattedMessage
                defaultMessage="Drop .js extension files to load them"
                description="Shown while dragging files over the extension manager"
                id="tw.extensionManager.dropOverlay"
              />
              <div className={styles.dropOverlayHint}>
                <FormattedMessage
                  defaultMessage="You will be asked to confirm before loading."
                  description="Secondary text shown while dragging files over the extension manager"
                  id="tw.extensionManager.dropOverlayHint"
                />
              </div>
            </div>
          </div>
        )}
        <Box className={styles.header}>
          <button className={styles.openCodeButton} onClick={handleOpenCode}>
            <img src={code} draggable={false} className={styles.openLibraryButtonIcon} />
          </button>
          <button className={styles.openLibraryButton} onClick={handleOpenLibrary}>
            <img src={add} draggable={false} className={styles.openLibraryButtonIcon} />
          </button>
          <button className={styles.openCustomExtension} onClick={handleOpenCustomExtension}>
            <img src={custom} draggable={false} className={styles.openLibraryButtonIcon} />
          </button>
        </Box>
        <div className={styles.content}>
          <span className={styles.dropHint}>
            <FormattedMessage
              defaultMessage="Tip: drag and drop .js extension files into this window to load them."
              description="Hint shown in the extension manager about drag and drop loading"
              id="tw.extensionManager.dropHint"
            />
          </span>
          <>
            {extensions.filter((item) => !TurboWarp_Exts.includes(item.id)).length == 0 ? (
              <span className={styles.tip}>
                <FormattedMessage
                  defaultMessage="Nothing... Try loading some extensions"
                  description="Loaded extensions is empty"
                  id="tw.extensionManager.tip"
                />
              </span>
            ) : (
              <span className={styles.allExts}>
                <FormattedMessage
                  defaultMessage="Loaded {LENGTH} extensions in total."
                  description="Loaded extensions isn't empty"
                  id="tw.extensionManager.total"
                  values={{
                    LENGTH: getAllDisplayExtensions(extensions)
                  }}
                />
              </span>
            )}
            {extensions.map((item, index) => {
              const isInternetExt = extensionsURLs.urls[Array.from(extensionsURLs.exts.keys()).findIndex(e => e === item.id)]?.startsWith('http');
              return (
                !TurboWarp_Exts.includes(item.id) && (
                  <div
                    key={item.id || `ext-${index}`}
                    style={{
                      backgroundColor: item.color2 == undefined ? item.color1 : item.color2,
                      position: 'relative',
                      ...(item.failed
                        ? {
                            border: '2px dashed rgba(255, 255, 255, 0.85)',
                            boxSizing: 'border-box'
                          }
                        : {})
                    }}
                    className={styles.Extbg}
                    title={item.failed ? item.failureReason : undefined}
                  >
                    <ExtensionImage
                      src={getExtensionBackground(item)}
                      alt={item.name}
                      onLoad={() => handleBackgroundLoad(item.id || index)}
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        height: '100%',
                        width: 'auto',
                        zIndex: 7,
                        WebkitMaskImage: 'linear-gradient(to right, black 0%, black 65%,  transparent 100%)',
                        maskImage: 'linear-gradient(to right, black 0%, black 65%, transparent 100%)',
                        pointerEvents: 'none'
                      }}
                    />
                    {backgroundLoaded[item.id || index] && (
                      <div
                        style={{
                          width: '175px'
                        }}
                      />
                    )}
                    <ExtensionImage
                      src={item.menuIconURI}
                      alt={item.name}
                      style={{
                        filter: 'drop-shadow(0px 0px 8px rgba(0, 0, 0, 0.3))',
                        marginLeft: '20px',
                        width: '48px',
                        height: '48px',
                        zIndex: '11'
                      }}
                    />
                    <div className={styles.manages}>
                      <div>
                        <div style={{ position: 'relative', zIndex: '11' }}>
                          <span
                            className={styles.ExtTitle}
                            style={{
                              textShadow:
                                '0 0 3px rgba(0, 0, 0, 0.8), 0 0 6px rgba(0, 0, 0, 0.8), 0 1px 2px rgba(0, 0, 0, 0.5)'
                            }}
                          >
                            {item.name}
                          </span>
                          <img className={styles.extensionTypeIcon} src={TurboWarp_IncludeExts.includes(item.id) ? BuiltInIcon : isInternetExt ? WebsiteIcon : FileIcon}
                            title={intl.formatMessage(TurboWarp_IncludeExts.includes(item.id) ?  messages.byBuiltIn : isInternetExt ? messages.byInternet : messages.byLocal)}
                          />
                          <br />
                          <span
                            className={styles.ExtId}
                            style={{
                              textShadow:
                                '0 0 3px rgba(0, 0, 0, 0.8), 0 0 6px rgba(0, 0, 0, 0.8), 0 1px 2px rgba(0, 0, 0, 0.5)'
                            }}
                          >
                            {item.id}
                          </span>
                          {item.failed && (
                            <div className={styles.failedInfo} title={item.failureReason}>
                              <span className={styles.failedBadge}>
                                <FormattedMessage
                                  defaultMessage="Registration failed"
                                  description="Badge shown when an extension loaded but failed to register its blocks"
                                  id="tw.extensionManager.registrationFailed"
                                />
                              </span>
                              <span className={styles.failedHint}>
                                <FormattedMessage
                                  defaultMessage="Open the console to view the loading error."
                                  description="Hint shown in a failed extension card telling the user where to find the error"
                                  id="tw.extensionManager.checkConsole"
                                />
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div>
                        {item.failed && (
                          <button
                            className={styles.button}
                            style={{
                              color: '#cf4a4a'
                            }}
                            disabled={!!reloadingExtensions[item.id]}
                            onClick={() => handleReloadExtension(item.id)}
                          >
                            {reloadingExtensions[item.id] ? (
                              <FormattedMessage
                                defaultMessage="Reloading..."
                                description="Text of the reload button while an extension is being reloaded"
                                id="tw.extensionManager.reloading"
                              />
                            ) : (
                              <FormattedMessage
                                defaultMessage="Reload"
                                description="Text of the reload button for an extension that failed to register"
                                id="tw.extensionManager.reload"
                              />
                            )}
                          </button>
                        )}
                        {!item.failed && (
                          <button
                            className={styles.button}
                            style={{
                              color: item.color2 == undefined ? item.color1 : item.color2
                            }}
                            onClick={() => {
                              dispatch(setPreviewExtData({data: vm.extensionManager.getExtensionURLs()[item.id] ?? `data:text/plain;base64,VEFUIFRoaXMgRXh0ZW5zaW9uIGlzIGJ1aWx0SW4gb3IgY2FuJ3QgYmUgbG9hZC4=`, svgs: getSVGfromOpcodes(getOpcodefromExt(item))}));
                              dispatch(openPreviewExt());
                            }}
                          >
                            <FormattedMessage
                              defaultMessage="Preview"
                              description="text of View "
                              id="tw.extensionManager.preview"
                            />
                          </button>
                        )}
                        {!item.failed && !TurboWarp_IncludeExts.includes(item.id) && (
                          <button
                            className={styles.button}
                            style={{
                              color: item.color2 == undefined ? item.color1 : item.color2
                            }}
                            onClick={() => {
                              fetch(getExt(item.id))
                                .then((response) => response.blob())
                                .then((blob) => {
                                  const link = document.createElement('a');
                                  link.href = URL.createObjectURL(blob);
                                  link.download = `${item.name}.js`;
                                  link.target = '_blank';
                                  link.click();
                                });
                            }}
                          >
                            <FormattedMessage
                              defaultMessage="Export"
                              description="text of Export "
                              id="tw.extensionManager.export"
                            />
                          </button>
                        )}
                        {!RemoveExpect_Exts.includes(item.id) && (
                          <button
                            className={styles.button}
                            style={{
                              color: item.color2 == undefined ? item.color1 : item.color2
                            }}
                            onClick={() => {
                              handleRemoveExtension(item.id);
                            }}
                          >
                            <FormattedMessage
                              defaultMessage="Remove"
                              description="text of Remove "
                              id="tw.extensionManager.remove"
                            />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              );
            })}
          </>
        </div>
      </div>
    </Modal>
  );
};

ExtensionChooser.propTypes = {
  intl: intlShape.isRequired,
  onRequestClose: PropTypes.func,
  onOpenExtensionLibrary: PropTypes.func,
  onOpenCustomExtensionModal: PropTypes.func,
  visible: PropTypes.bool,
  vm: PropTypes.object,
  dispatch: PropTypes.func.isRequired
};

export default injectIntl(ExtensionChooser);
