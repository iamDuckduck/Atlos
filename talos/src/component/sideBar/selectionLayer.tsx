import React, { useLayoutEffect, useRef, useState } from 'react';
import styles from './sideBar.module.scss';
import { useBoxSelection } from './useBoxSelection';

interface SelectionLayerProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
}

export const SelectionLayer = ({ containerRef }: SelectionLayerProps) => {
    const selectionBoxRef = useRef<HTMLDivElement | null>(null);
    const { isSelecting } = useBoxSelection(containerRef, selectionBoxRef);
    
    const [isVisible, setIsVisible] = useState(false);
    const [isFading, setIsFading] = useState(false);

    useLayoutEffect(() => {
        if (isSelecting) {
            setIsVisible(true);
            setIsFading(false);
            return;
        }

        if (!isVisible) return;

        setIsFading(false);
        const raf = requestAnimationFrame(() => {
            setIsFading(true);
        });

        const timer = setTimeout(() => {
            setIsVisible(false);
        }, 300);

        return () => {
            cancelAnimationFrame(raf);
            clearTimeout(timer);
        };
    }, [isSelecting, isVisible]);

    return (
        <div
            ref={selectionBoxRef}
            className={`${styles.selectionBox} ${isVisible ? '' : styles.hidden} ${isFading ? styles.fadeOut : ''}`}
        />
    );
};
