import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import styles from './context-menu.css';

const ContextMenu = ({ x, y, items, onClose }) => {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClick = () => onClose();
    const handleScroll = () => onClose();
    document.addEventListener('click', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  // Adjust position so the menu stays within the viewport
  const adjustedX = Math.min(x, window.innerWidth - 160);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 32);

  return (
    <div ref={menuRef} className={styles.contextMenu} style={{ left: adjustedX, top: adjustedY }}>
      {items.map((item, index) => (
        <div
          key={index}
          className={styles.menuItem}
          onClick={(e) => {
            e.stopPropagation();
            item.onClick();
            onClose();
          }}
        >
          {item.icon && <img className={styles.menuIcon} src={item.icon} alt="" draggable={false} />}
          <span className={styles.menuLabel}>{item.label}</span>
        </div>
      ))}
    </div>
  );
};

ContextMenu.propTypes = {
  x: PropTypes.number.isRequired,
  y: PropTypes.number.isRequired,
  items: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      icon: PropTypes.string,
      onClick: PropTypes.func.isRequired
    })
  ).isRequired,
  onClose: PropTypes.func.isRequired
};

export default ContextMenu;
