import { defineMessages, FormattedMessage, intlShape, injectIntl } from 'react-intl';
import PropTypes from 'prop-types';
import React, { useRef } from 'react';
import Modal from '../../containers/modal.jsx';
import styles from './ae-preview-ext.css';

// 定义翻译消息
const messages = defineMessages({
  title: {
    defaultMessage: 'Preview Extension',
    description: 'Title of Preview Extension modal',
    id: 'tw.previewextension.title'
  }
});

// 展示组件
const PreviewExtComponent = (props) => {
  /** @type {string} */
  const extContent = props.svgList;
  const textareaRef = useRef(null);
  const decode = () => {
    if(extContent.startsWith('http')) {
      void (async function(){
        const extText = await fetch(extContent);
        if(extText.ok && textareaRef.current) textareaRef.current.value = await extText.text();
        else textareaRef.current.value = 'Cannot display extension preview.';
      })()
      return 'Loading...';
    }
    return decodeDataURL(extContent).text
  }
  function decodeDataURL(dataURL) {
    const comma = dataURL.indexOf(',');
    if (comma === -1) throw new Error('Invalid Data URL');

    const meta = dataURL.slice(5, comma);
    let data = dataURL.slice(comma + 1);
    const isBase64 = /;base64/i.test(meta);
    const mime = meta.split(';')[0] || 'text/plain';

    if (isBase64) {
      const binary = atob(data.replace(/\s/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { mime, bytes, text: new TextDecoder().decode(bytes) };
    }

    const text = decodeURIComponent(data);
    return { mime, bytes: null, text };
  }
  return (
    <Modal
      className={styles.modalContent}
      onRequestClose={props.onClose}
      contentLabel={props.intl.formatMessage(messages.title)}
      id="previewExt"
    >
      {/* Modal 内容 */}
      <div className={styles.body}>
        <textarea ref={textareaRef} className={styles.textarea} value={decode()} readOnly />
      </div>
    </Modal>
)};

PreviewExtComponent.propTypes = {
  intl: intlShape,
  onClose: PropTypes.func.isRequired,
  svgList: PropTypes.string
};

export default injectIntl(PreviewExtComponent);
