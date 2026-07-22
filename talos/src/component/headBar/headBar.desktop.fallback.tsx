import styles from './headbar.module.scss';
import React from 'react';

interface HeadBarDesktopFallbackProps {
    children: React.ReactNode;
    compact?: boolean;
}

const HeadBarDesktopFallback: React.FC<HeadBarDesktopFallbackProps> = ({ children, compact = false }) => {
    return (
        <div
            className={`${styles.headbarFallback} ${compact ? styles.compactFallback : ''}`}
            style={{
                position: 'fixed',
                top: '1rem',
                right: '1rem',
            }}
        >
            <div className={`${styles.headbar} ${compact ? styles.visibilityOnly : ''}`}>
                {children}
            </div>
        </div>
    );
};

export default HeadBarDesktopFallback;
