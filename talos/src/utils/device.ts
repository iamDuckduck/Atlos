import { useState, useEffect, useCallback } from 'react';
import { getAppViewport, subscribeAppViewport } from '@/component/scale/pip';

export const MOBILE_BREAKPOINT = 768;
export const TABLET_BREAKPOINT = 1024;
export const DESKTOPER_BREAKPOINT = 1920;
export const DESKTOPEST_BREAKPOINT = 2560;

export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'desktoper' | 'desktopest';

interface UseDeviceResult {
    type: DeviceType;
    isMobile: boolean;
    isTablet: boolean;
    isDesktop: boolean;
    isDesktoper: boolean;
    isDesktopest: boolean;
    isPictureInPicture: boolean;
    width: number;
    height: number;
}

export function useDevice(
    mobileBP: number = MOBILE_BREAKPOINT,
    tabletBP: number = TABLET_BREAKPOINT,
    desktoperBP: number = DESKTOPER_BREAKPOINT,
    desktopestBP: number = DESKTOPEST_BREAKPOINT,
): UseDeviceResult {
    const getDeviceType = useCallback((): DeviceType => {
        if (typeof window === 'undefined') return 'desktop'; // SSR fallback
        const viewport = getAppViewport();
        const width = viewport.width;
        const effectiveMobileBP = viewport.inPictureInPicture ? viewport.mobileBreakpoint : mobileBP;
        if (width <= effectiveMobileBP) return 'mobile';
        if (width <= tabletBP) return 'tablet';
        if (width >= desktopestBP) return 'desktopest';
        if (width >= desktoperBP) return 'desktoper';
        return 'desktop';
    }, [mobileBP, tabletBP, desktoperBP, desktopestBP]);

    const [deviceType, setDeviceType] = useState<DeviceType>(getDeviceType);

    useEffect(() => {
        const handleResize = () => setDeviceType(getDeviceType());
        handleResize();
        window.addEventListener('resize', handleResize);
        const unsubscribeViewport = subscribeAppViewport(() => {
            handleResize();
        });
        return () => {
            window.removeEventListener('resize', handleResize);
            unsubscribeViewport();
        };
    }, [getDeviceType]);

    const viewport = getAppViewport();

    return {
        type: deviceType,
        isMobile: deviceType === 'mobile',
        isTablet: deviceType === 'tablet',
        isDesktop: deviceType === 'desktop' || deviceType === 'desktoper' || deviceType === 'desktopest',
        isDesktoper: deviceType === 'desktoper' || deviceType === 'desktopest',
        isDesktopest: deviceType === 'desktopest',
        isPictureInPicture: viewport.inPictureInPicture,
        width: viewport.width,
        height: viewport.height,
    };
}
