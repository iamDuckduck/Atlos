import { useCallback, useEffect, useState } from 'react';
import {
    getAppDocument,
    getAppViewport,
    PIP_UI_MINIMUM_EDGE,
    subscribeAppViewport,
    subscribePictureInPictureState,
} from '@/component/scale/pip';
import { isApplePlatform } from '@/utils/platform';

const COMPACT_PIP_UI_THRESHOLD = 360;

type AppViewport = ReturnType<typeof getAppViewport>;

const shouldAutoHideUIInPictureInPicture = (
    viewport: Pick<AppViewport, 'height' | 'inPictureInPicture' | 'width'>,
): boolean => (
    viewport.inPictureInPicture
    && Math.min(viewport.width, viewport.height) < COMPACT_PIP_UI_THRESHOLD
);

const shouldHideVisibilityControl = (
    viewport: Pick<AppViewport, 'height' | 'inPictureInPicture' | 'width'>,
): boolean => (
    viewport.inPictureInPicture
    && Math.min(viewport.width, viewport.height) < PIP_UI_MINIMUM_EDGE
);

const isUIVisibilityShortcut = (event: KeyboardEvent): boolean => {
    if (event.key.toLowerCase() !== 'h' || event.altKey || event.shiftKey) return false;
    return isApplePlatform() ? event.metaKey : event.ctrlKey;
};

export const useUIVisibility = () => {
    const [uiVisible, setUiVisible] = useState(true);
    const [showVisibilityControl, setShowVisibilityControl] = useState(true);
    const [shortcutDocument, setShortcutDocument] = useState<Document>(getAppDocument);
    const toggleUI = useCallback(() => {
        if (shouldHideVisibilityControl(getAppViewport())) return;
        setUiVisible((visible) => !visible);
    }, []);

    useEffect(() => {
        let activeDocument: Document | null = null;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!isUIVisibilityShortcut(event)) return;
            event.preventDefault();
            event.stopPropagation();
            toggleUI();
        };

        const bindShortcut = () => {
            activeDocument?.removeEventListener('keydown', handleKeyDown, true);
            activeDocument = getAppDocument();
            activeDocument.addEventListener('keydown', handleKeyDown, true);
            setShortcutDocument(activeDocument);
        };

        bindShortcut();
        const unsubscribePictureInPicture = subscribePictureInPictureState(bindShortcut);

        return () => {
            unsubscribePictureInPicture();
            activeDocument?.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [toggleUI]);

    useEffect(() => {
        const syncPictureInPictureLayout = () => {
            const viewport = getAppViewport();
            const hideVisibilityControl = shouldHideVisibilityControl(viewport);
            setShowVisibilityControl(!hideVisibilityControl);

            if (shouldAutoHideUIInPictureInPicture(viewport)) {
                setUiVisible(false);
            }
        };

        const handlePictureInPictureState = (active: boolean) => {
            if (!active) {
                setShowVisibilityControl(true);
                setUiVisible(true);
                return;
            }

            const viewport = getAppViewport();
            const hideVisibilityControl = shouldHideVisibilityControl(viewport);
            setShowVisibilityControl(!hideVisibilityControl);
            setUiVisible(!shouldAutoHideUIInPictureInPicture(viewport));
        };

        syncPictureInPictureLayout();
        const unsubscribeViewport = subscribeAppViewport(syncPictureInPictureLayout);
        const unsubscribePictureInPicture = subscribePictureInPictureState(handlePictureInPictureState);

        return () => {
            unsubscribeViewport();
            unsubscribePictureInPicture();
        };
    }, []);

    return { shortcutDocument, showVisibilityControl, uiVisible, toggleUI };
};
