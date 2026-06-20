import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './banner.module.scss';
import Button from '@/component/button/button';
import { useTranslateUI } from '@/locale';

const BANNER_EXIT_DURATION_MS = 200;

interface BannerProps {
    content: React.ReactNode;
    onClose: () => void;
    schema?: 'light' | 'dark';
    open?: boolean;
}

const Banner: React.FC<BannerProps> = ({ content, onClose, schema = 'light', open = true }) => {
    const t = useTranslateUI();
    const [present, setPresent] = useState(open);
    const [closing, setClosing] = useState(false);
    const [renderedContent, setRenderedContent] = useState(content);
    const closeRequestedRef = useRef(false);
    const closeTimerRef = useRef<number | null>(null);
    const presentRef = useRef(open);
    const closingRef = useRef(false);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    const clearCloseTimer = useCallback(() => {
        if (closeTimerRef.current === null) return;
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
    }, []);

    const finishClose = useCallback(() => {
        clearCloseTimer();
        const shouldNotify = closeRequestedRef.current;
        closeRequestedRef.current = false;
        closingRef.current = false;
        presentRef.current = false;
        setClosing(false);
        setPresent(false);
        if (shouldNotify) onCloseRef.current();
    }, [clearCloseTimer]);

    const startClose = useCallback((notify: boolean) => {
        if (!presentRef.current || closingRef.current) return;
        closeRequestedRef.current = notify;
        closingRef.current = true;
        setClosing(true);
        clearCloseTimer();
        closeTimerRef.current = window.setTimeout(finishClose, BANNER_EXIT_DURATION_MS + 50);
    }, [clearCloseTimer, finishClose]);

    useEffect(() => {
        if (open) {
            clearCloseTimer();
            closeRequestedRef.current = false;
            presentRef.current = true;
            closingRef.current = false;
            setRenderedContent(content);
            setPresent(true);
            setClosing(false);
            return;
        }
        startClose(false);
    }, [clearCloseTimer, content, open, startClose]);

    useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

    if (!present) return null;

    return (
        <div
            className={styles.bannerContainer}
            data-closing={closing || undefined}
            onAnimationEnd={(event) => {
                if (event.currentTarget !== event.target || !closingRef.current) return;
                finishClose();
            }}
        >
            <div className={styles.bannerWrap}>
                <div className={styles.bannerContent}>
                    <span className={styles.bannerText}>{renderedContent}</span>
                </div>
                <Button
                    text={t('common.close')}
                    aria-label={t('common.close')}
                    buttonType='close'
                    buttonStyle='icon'
                    schema={schema}
                    size='1.2rem'
                    onClick={() => startClose(true)}
                />
            </div>
        </div>
    );
};

export default Banner;
