import React, { useEffect, useRef, useState } from 'react';
import { useFilter, useSetFilter } from '@/store/marker';

type Point = { x: number; y: number };
type SelectionBox = { startX: number; startY: number; endX: number; endY: number };
type ContentRect = { left: number; right: number; top: number; bottom: number };
type SelectorHitTarget = { key: string; rect: ContentRect; element: HTMLElement };
type BinderHitTarget = { keys: string[]; rect: ContentRect; element: HTMLElement };
type ScrollGeometry = {
    clientLeft: number;
    clientTop: number;
    clientBottom: number;
    offsetLeft: number;
    offsetTop: number;
    viewportTop: number;
    viewportBottom: number;
};

const DRAG_START_THRESHOLD_SQ = 24;
const AUTO_SCROLL_EDGE_SIZE = 32;
const AUTO_SCROLL_MIN_SPEED = 120;
const AUTO_SCROLL_MAX_SPEED = 2200;
const AUTO_SCROLL_ACCELERATION = 16;
const FILTER_UPDATE_BATCH_SIZE = 5;

export const useBoxSelection = (
    containerRef: React.RefObject<HTMLDivElement | null>,
    selectionBoxRef: React.RefObject<HTMLDivElement | null>,
) => {
    const filter = useFilter();
    const setFilter = useSetFilter();
    const currentFilterRef = useRef(filter);
    const [isSelecting, setIsSelecting] = useState(false);

    useEffect(() => { currentFilterRef.current = filter; }, [filter]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let startPoint: Point | null = null;
        let lastClientPoint: Point | null = null;
        let activeScrollContainer: HTMLElement | null = null;
        let activeScrollGeometry: ScrollGeometry | null = null;
        let activePointerId: number | null = null;
        let isDragging = false;
        let initialFilter: string[] = [];
        let currentOptimisticSet = new Set<string>();
        let selectorTargets: SelectorHitTarget[] = [];
        let binderTargets: BinderHitTarget[] = [];
        let lastFilterSignature = '';
        let pendingFilterSet: Set<string> | null = null;
        let pendingFilterChangeCount = 0;
        let previousBodyUserSelect = '';
        let previousScrollBehavior = '';
        let autoScrollRaf: number | null = null;
        let autoScrollLastTimestamp = 0;
        let selectionUpdateRaf: number | null = null;
        let pendingSelectionClientPoint: Point | null = null;
        let pendingSelectionScrollContainer: HTMLElement | null = null;

        const getScrollContainer = () =>
            container.querySelector<HTMLElement>('[data-sidescroll="true"]') ?? container;

        const measureScrollGeometry = (scrollContainer: HTMLElement): ScrollGeometry => {
            const scrollRect = scrollContainer.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const offsetLeft = scrollRect.left - containerRect.left;
            const offsetTop = scrollRect.top - containerRect.top;

            return {
                clientLeft: scrollRect.left,
                clientTop: scrollRect.top,
                clientBottom: scrollRect.bottom,
                offsetLeft,
                offsetTop,
                viewportTop: offsetTop,
                viewportBottom: offsetTop + scrollRect.height,
            };
        };

        const getScrollGeometry = (scrollContainer: HTMLElement) =>
            activeScrollGeometry ?? measureScrollGeometry(scrollContainer);

        const toContentPoint = (scrollContainer: HTMLElement, clientPoint: Point): Point => {
            const geometry = getScrollGeometry(scrollContainer);
            return {
                x: clientPoint.x - geometry.clientLeft + scrollContainer.scrollLeft,
                y: clientPoint.y - geometry.clientTop + scrollContainer.scrollTop,
            };
        };

        const contentToContainerPoint = (scrollContainer: HTMLElement, point: Point): Point => {
            const geometry = getScrollGeometry(scrollContainer);
            return {
                x: point.x - scrollContainer.scrollLeft + geometry.offsetLeft,
                y: point.y - scrollContainer.scrollTop + geometry.offsetTop,
            };
        };

        const elementToContentRect = (scrollContainer: HTMLElement, el: Element): ContentRect => {
            const rect = el.getBoundingClientRect();
            const geometry = getScrollGeometry(scrollContainer);
            return {
                left: rect.left - geometry.clientLeft + scrollContainer.scrollLeft,
                right: rect.right - geometry.clientLeft + scrollContainer.scrollLeft,
                top: rect.top - geometry.clientTop + scrollContainer.scrollTop,
                bottom: rect.bottom - geometry.clientTop + scrollContainer.scrollTop,
            };
        };

        const getAutoScrollVelocity = (scrollContainer: HTMLElement, clientY: number) => {
            const geometry = getScrollGeometry(scrollContainer);
            const topOverflow = geometry.clientTop + AUTO_SCROLL_EDGE_SIZE - clientY;
            const bottomOverflow = clientY - (geometry.clientBottom - AUTO_SCROLL_EDGE_SIZE);
            const overflow =
                bottomOverflow > 0 ? bottomOverflow :
                topOverflow > 0 ? -topOverflow :
                0;

            if (overflow === 0) return 0;

            const speed = Math.min(
                AUTO_SCROLL_MAX_SPEED,
                AUTO_SCROLL_MIN_SPEED + Math.abs(overflow) * AUTO_SCROLL_ACCELERATION,
            );
            return Math.sign(overflow) * speed;
        };

        const isIntersecting = (rect: ContentRect, box: ContentRect) =>
            !(rect.left > box.right || rect.right < box.left || rect.top > box.bottom || rect.bottom < box.top);

        const applySelectionBoxStyle = (box: SelectionBox) => {
            const el = selectionBoxRef.current;
            if (!el) return;

            const left = Math.min(box.startX, box.endX);
            const top = Math.min(box.startY, box.endY);
            const width = Math.abs(box.endX - box.startX);
            const height = Math.abs(box.endY - box.startY);

            el.style.transform = `translate3d(${left}px, ${top}px, 0)`;
            el.style.width = `${width}px`;
            el.style.height = `${height}px`;
        };

        const applyFilter = (nextSet: Set<string>) => {
            const nextFilter = Array.from(nextSet);
            const signature = nextFilter.join('\0');
            if (signature === lastFilterSignature) return;
            lastFilterSignature = signature;
            setFilter(nextFilter);
        };

        const syncOptimisticActiveState = (nextSet: Set<string>) => {
            selectorTargets.forEach((it) => {
                it.element.dataset.active = nextSet.has(it.key) ? 'true' : 'false';
            });

            binderTargets.forEach((it) => {
                const allActive = it.keys.length > 0 && it.keys.every((key) => nextSet.has(key));
                it.element.dataset.active = allActive ? 'true' : 'false';
            });
        };

        const flushPendingFilter = () => {
            if (!pendingFilterSet) return;
            applyFilter(pendingFilterSet);
            pendingFilterSet = null;
            pendingFilterChangeCount = 0;
        };

        const queueFilterUpdate = (nextSet: Set<string>) => {
            const nextSignature = Array.from(nextSet).join('\0');
            const currentSignature = Array.from(currentOptimisticSet).join('\0');
            if (nextSignature === currentSignature) return;

            currentOptimisticSet = new Set(nextSet);
            syncOptimisticActiveState(currentOptimisticSet);
            pendingFilterSet = new Set(nextSet);
            pendingFilterChangeCount += 1;

            if (pendingFilterChangeCount >= FILTER_UPDATE_BATCH_SIZE) {
                flushPendingFilter();
            }
        };

        const updateSelection = (clientPoint: Point, scrollContainer: HTMLElement) => {
            if (!startPoint) return;

            const currentPoint = toContentPoint(scrollContainer, clientPoint);
            const startViewPoint = contentToContainerPoint(scrollContainer, startPoint);
            const endViewPoint = contentToContainerPoint(scrollContainer, currentPoint);
            const geometry = getScrollGeometry(scrollContainer);
            const clampViewportY = (value: number) => Math.max(geometry.viewportTop, Math.min(geometry.viewportBottom, value));

            applySelectionBoxStyle({
                startX: startViewPoint.x,
                startY: clampViewportY(startViewPoint.y),
                endX: endViewPoint.x,
                endY: clampViewportY(endViewPoint.y),
            });

            const box: ContentRect = {
                left: Math.min(startPoint.x, currentPoint.x),
                right: Math.max(startPoint.x, currentPoint.x),
                top: Math.min(startPoint.y, currentPoint.y),
                bottom: Math.max(startPoint.y, currentPoint.y),
            };

            const nextSet = new Set(initialFilter);
            const binderHandledKeys = new Set<string>();

            binderTargets.forEach((it) => {
                if (!isIntersecting(it.rect, box)) return;

                it.keys.forEach((key) => {
                    nextSet.add(key);
                    binderHandledKeys.add(key);
                });
            });

            selectorTargets.forEach((it) => {
                // If this key has been handled by a binder hit, skip to avoid double-toggle.
                if (binderHandledKeys.has(it.key)) return;
                if (!isIntersecting(it.rect, box)) return;

                // Toggle logic: if key was in initial set, remove it. If not, add it.
                if (nextSet.has(it.key)) nextSet.delete(it.key);
                else nextSet.add(it.key);
            });

            queueFilterUpdate(nextSet);
        };

        const cancelSelectionUpdate = () => {
            if (selectionUpdateRaf !== null) {
                cancelAnimationFrame(selectionUpdateRaf);
                selectionUpdateRaf = null;
            }
            pendingSelectionClientPoint = null;
            pendingSelectionScrollContainer = null;
        };

        const flushSelectionUpdate = () => {
            if (selectionUpdateRaf !== null) {
                cancelAnimationFrame(selectionUpdateRaf);
                selectionUpdateRaf = null;
            }

            if (pendingSelectionClientPoint && pendingSelectionScrollContainer) {
                updateSelection(pendingSelectionClientPoint, pendingSelectionScrollContainer);
            }
            pendingSelectionClientPoint = null;
            pendingSelectionScrollContainer = null;
            flushPendingFilter();
        };

        const requestSelectionUpdate = (clientPoint: Point, scrollContainer: HTMLElement) => {
            pendingSelectionClientPoint = clientPoint;
            pendingSelectionScrollContainer = scrollContainer;

            if (selectionUpdateRaf !== null) return;

            selectionUpdateRaf = requestAnimationFrame(() => {
                selectionUpdateRaf = null;
                if (pendingSelectionClientPoint && pendingSelectionScrollContainer) {
                    updateSelection(pendingSelectionClientPoint, pendingSelectionScrollContainer);
                }
                pendingSelectionClientPoint = null;
                pendingSelectionScrollContainer = null;
            });
        };

        const stopAutoScroll = () => {
            if (autoScrollRaf !== null) {
                cancelAnimationFrame(autoScrollRaf);
                autoScrollRaf = null;
            }
            autoScrollLastTimestamp = 0;
        };

        const runAutoScroll = (timestamp: number) => {
            autoScrollRaf = null;
            if (!isDragging || !lastClientPoint || !activeScrollContainer) {
                autoScrollLastTimestamp = 0;
                return;
            }

            const velocity = getAutoScrollVelocity(activeScrollContainer, lastClientPoint.y);
            if (velocity === 0) {
                autoScrollLastTimestamp = 0;
                return;
            }

            if (!autoScrollLastTimestamp) {
                autoScrollLastTimestamp = timestamp;
                autoScrollRaf = requestAnimationFrame(runAutoScroll);
                return;
            }

            const deltaSeconds = Math.min(0.05, (timestamp - autoScrollLastTimestamp) / 1000);
            autoScrollLastTimestamp = timestamp;

            const maxScrollTop = activeScrollContainer.scrollHeight - activeScrollContainer.clientHeight;
            const before = activeScrollContainer.scrollTop;
            const atLimit = (velocity < 0 && before <= 0) || (velocity > 0 && before >= maxScrollTop);
            if (atLimit) {
                autoScrollLastTimestamp = 0;
                return;
            }

            activeScrollContainer.scrollTop = before + velocity * deltaSeconds;
            if (activeScrollContainer.scrollTop !== before) {
                cancelSelectionUpdate();
                updateSelection(lastClientPoint, activeScrollContainer);
            }

            autoScrollRaf = requestAnimationFrame(runAutoScroll);
        };

        const updateAutoScroll = () => {
            if (!isDragging || !lastClientPoint || !activeScrollContainer) {
                stopAutoScroll();
                return;
            }

            if (getAutoScrollVelocity(activeScrollContainer, lastClientPoint.y) === 0) {
                stopAutoScroll();
                return;
            }

            if (autoScrollRaf === null) {
                autoScrollRaf = requestAnimationFrame(runAutoScroll);
            }
        };

        const cleanupSelection = () => {
            stopAutoScroll();
            cancelSelectionUpdate();
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerCancel);
            activeScrollContainer?.removeEventListener('scroll', onScroll);
            if (activePointerId !== null) {
                if (container.hasPointerCapture(activePointerId)) {
                    container.releasePointerCapture(activePointerId);
                }
                document.body.style.userSelect = previousBodyUserSelect;
                if (activeScrollContainer) {
                    activeScrollContainer.style.scrollBehavior = previousScrollBehavior;
                }
            }
            startPoint = null;
            lastClientPoint = null;
            activeScrollContainer = null;
            activeScrollGeometry = null;
            activePointerId = null;
            isDragging = false;
            initialFilter = [];
            currentOptimisticSet = new Set<string>();
            lastFilterSignature = '';
            pendingFilterSet = null;
            pendingFilterChangeCount = 0;
            previousScrollBehavior = '';
            setIsSelecting(false);
            selectorTargets = [];
            binderTargets = [];
        };

        const onPointerDown = (e: PointerEvent) => {
            if (activePointerId !== null || !e.isPrimary) return;
            if ((e.pointerType === 'mouse' && e.button !== 0) || e.defaultPrevented) return;
            const target = e.target as HTMLElement;
            // Ignore interactive elements
            if (target.closest('button') || target.closest('input') || target.closest('[data-drag-handle]')) return;
            // Ignore drawer area
            if (target.closest(`div[class*="triggerDrawer"]`)) return;

            const scrollContainer = getScrollContainer();
            if (!scrollContainer.contains(target)) return;

            activeScrollContainer = scrollContainer;
            activeScrollGeometry = measureScrollGeometry(scrollContainer);
            activePointerId = e.pointerId;
            lastClientPoint = { x: e.clientX, y: e.clientY };
            startPoint = toContentPoint(scrollContainer, lastClientPoint);
            initialFilter = [...currentFilterRef.current];
            currentOptimisticSet = new Set(initialFilter);
            lastFilterSignature = initialFilter.join('\0');
            
            // Gather all selectable selectors and binder headers.
            selectorTargets = [];
            binderTargets = [];

            const elements = container.querySelectorAll('[data-key], [data-binder-keys]');
            elements.forEach((el) => {
                if (!scrollContainer.contains(el)) return;

                // Use checkVisibility to respect visibility: hidden (which we use for collapsed groups)
                // checkVisibility is a modern DOM API - type assertion needed for compatibility
                const element = el as HTMLElement & { checkVisibility?: () => boolean };
                if (element.checkVisibility && !element.checkVisibility()) return;

                const filterContent = el.closest('[data-filter-content="true"]');
                if (filterContent?.getAttribute('data-expanded') === 'false') return;
                
                const key = el.getAttribute('data-key');
                if (key) {
                    selectorTargets.push({
                        key,
                        rect: elementToContentRect(scrollContainer, el),
                        element,
                    });
                }

                const binderKeysAttr = el.getAttribute('data-binder-keys');
                if (binderKeysAttr) {
                    const keys = binderKeysAttr
                        .split(',')
                        .map(k => k.trim())
                        .filter(Boolean);

                    if (keys.length > 0) {
                        const binderWrap = element.closest<HTMLElement>('[data-binder-wrap="true"]') ?? element;
                        binderTargets.push({
                            keys,
                            rect: elementToContentRect(scrollContainer, el),
                            element: binderWrap,
                        });
                    }
                }
            });

            // Disable user-select during selection to enforce box selection
            previousBodyUserSelect = document.body.style.userSelect;
            previousScrollBehavior = scrollContainer.style.scrollBehavior;
            document.body.style.userSelect = 'none';
            scrollContainer.style.scrollBehavior = 'auto';

            container.setPointerCapture(e.pointerId);

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            window.addEventListener('pointercancel', onPointerCancel);
            scrollContainer.addEventListener('scroll', onScroll, { passive: true });
        };

        const onPointerMove = (e: PointerEvent) => {
            if (e.pointerId !== activePointerId) return;
            if (!startPoint || !activeScrollContainer) return;

            lastClientPoint = { x: e.clientX, y: e.clientY };
            const curPoint = toContentPoint(activeScrollContainer, lastClientPoint);

            if (!isDragging) {
                const dx = curPoint.x - startPoint.x;
                const dy = curPoint.y - startPoint.y;
                // Threshold to start dragging
                if (dx * dx + dy * dy > DRAG_START_THRESHOLD_SQ) {
                    isDragging = true;
                    setIsSelecting(true);
                }
            }

            if (isDragging) {
                requestSelectionUpdate(lastClientPoint, activeScrollContainer);
                updateAutoScroll();
            }
        };

        const onScroll = () => {
            if (!isDragging || !lastClientPoint || !activeScrollContainer) return;
            if (autoScrollRaf !== null) return;
            requestSelectionUpdate(lastClientPoint, activeScrollContainer);
        };

        const onPointerUp = (e: PointerEvent) => {
            if (e.pointerId !== activePointerId) return;
            flushSelectionUpdate();
            cleanupSelection();
        };

        const onPointerCancel = (e: PointerEvent) => {
            if (e.pointerId !== activePointerId) return;
            flushSelectionUpdate();
            cleanupSelection();
        };

        container.addEventListener('pointerdown', onPointerDown);
        return () => {
            container.removeEventListener('pointerdown', onPointerDown);
            cleanupSelection();
        };
    }, [setFilter, containerRef, selectionBoxRef]);

    return { isSelecting };
};
