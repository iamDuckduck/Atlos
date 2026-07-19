import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import styles from './detail.module.scss';
import Button from '@/component/button/button';
import Modal from '@/component/modal/modal';
import PopoverTooltip from '@/component/popover/popover';
import OverflowPopoverText from '@/component/popover/OverflowPopoverText';
import Uploader from '../uploader/uploader';
import Comments, { CommentExcerpt } from './comment/Comments';
import { flatList } from './comment/commentsTree';
import { useAutoTrans } from './comment/useAutoTrans';
import { useGlobalCollectionRate } from './useGlobalCollectionRate';

import parse from 'html-react-parser';
import { getItemIconUrl, getFileContentUrl, fetchArchiveFile } from '@/utils/resource.ts';
import { parseArchiveJsonResponse, createArchiveHtmlParserOptions } from './archiveFullText';
import { getLoadedRegionMarkers, loadRegionMarkers, MARKER_TYPE_DICT } from '@/data/marker';
import { usePointShareLink } from '@/utils/shareLink';
import useRegion from '@/store/region';
import { listUGCComments, resolveUGCUploadTarget, type UGCComment } from '@/utils/ugcClient';

import BossIcon from '@/assets/images/category/boss.svg?react';
import CollectionIcon from '@/assets/images/category/collection.svg?react';
import ExplorationIcon from '@/assets/images/category/exploration.svg?react';
import CombatIcon from '@/assets/images/category/combat.svg?react';
import FacilityIcon from '@/assets/images/category/facility.svg?react';
import MobIcon from '@/assets/images/category/mob.svg?react';
import NaturalIcon from '@/assets/images/category/natural.svg?react';
import NpcIcon from '@/assets/images/category/npc.svg?react';
import ValuableIcon from '@/assets/images/category/valuable.svg?react';
import ArchivesIcon from '@/assets/images/category/archives.svg?react';
import CollectAllIcon from '@/assets/logos/collectall.svg?react';
import GeneralInfoIcon from '@/assets/logos/general_info.svg?react';
import CommentIcon from '@/assets/logos/comment.svg?react';

import {
    useMarkerStore,
    useRegionMarkerCount,
    useWorldMarkerCount,
    useSubregionMarkerCount,
} from '@/store/marker.ts';
import {
    useUserRecord,
} from '@/store/userRecord.ts';
import { commitPointProgress } from '@/store/history';
import classNames from 'classnames';
import { useTranslateGame, useTranslateUI, useLocale } from '@/locale';

// Category icon mapping
const CATEGORY_ICON_MAP: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
    boss: BossIcon,
    collection: CollectionIcon,
    archives: ArchivesIcon,
    combat: CombatIcon,
    facility: FacilityIcon,
    mob: MobIcon,
    natural: NaturalIcon,
    npc: NpcIcon,
    valuable: ValuableIcon,
    exploration: ExplorationIcon,
};

type DetailPhase = 'hidden' | 'entering' | 'open' | 'exiting';
type DetailTab = 'general' | 'comments';

interface DetailProps {
    inline?: boolean;
    className?: string;
}

const DETAIL_EXIT_DURATION_MS = 300;
const TAB_INDICATOR_SETTLE_MS = 400;

interface TabSwipeBounds {
    startCenter: number;
    targetTab: DetailTab;
    targetStart: number;
    targetEnd: number;
    minCenter: number;
    maxCenter: number;
}

interface TabTouchGesture {
    identifier: number;
    startX: number;
    startY: number;
    intent: 'pending' | 'horizontal' | 'vertical';
    indicatorLeft: number;
}

const parseCssPixelValue = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const getElementMaxHeight = (element: HTMLElement): number => {
    const { maxHeight } = window.getComputedStyle(element);
    if (!maxHeight || maxHeight === 'none') return Number.POSITIVE_INFINITY;
    const parsed = parseCssPixelValue(maxHeight);
    return parsed > 0 ? parsed : Number.POSITIVE_INFINITY;
};

const getElementNaturalHeight = (element: HTMLElement): number => {
    const style = window.getComputedStyle(element);
    const paddingHeight = parseCssPixelValue(style.paddingTop) + parseCssPixelValue(style.paddingBottom);
    const gap = parseCssPixelValue(style.rowGap || style.gap);
    const children = Array.from(element.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
    const childrenHeight = children.reduce((sum, child) => {
        const childStyle = window.getComputedStyle(child);
        return sum
            + child.getBoundingClientRect().height
            + parseCssPixelValue(childStyle.marginTop)
            + parseCssPixelValue(childStyle.marginBottom);
    }, 0);
    return paddingHeight + childrenHeight + gap * Math.max(0, children.length - 1);
};

const getTopRatedComment = (comments: UGCComment[]): UGCComment | null => {
    const allComments = flatList(comments);
    if (allComments.length === 0) return null;
    return allComments.reduce((topComment, comment) => (
        comment.score > topComment.score ? comment : topComment
    ));
};

export const Detail = ({ inline = false, className }: DetailProps) => {
    /**
     * @type {import('../mapContainer/store/marker.type').IMarkerData}
     */
    const currentPoint = useMarkerStore((state) => state.currentActivePoint);
    const currentPointId = currentPoint?.id;
    const isImageUploadable = Boolean(currentPoint && resolveUGCUploadTarget(currentPoint));
    const globalCollectionRate = useGlobalCollectionRate(currentPointId, isImageUploadable);
    const pointsRecord = useUserRecord();
    const currentRegion = useRegion((state) => state.currentRegionKey);
    const isCollected = currentPoint
        ? pointsRecord.includes(currentPoint.id)
        : false;

    const categorySubKey = currentPoint ? MARKER_TYPE_DICT[currentPoint.type]?.category?.sub : undefined;
    const CategoryIcon = categorySubKey ? CATEGORY_ICON_MAP[categorySubKey] : undefined;
    
    const typeEntry = currentPoint ? MARKER_TYPE_DICT[currentPoint.type] : undefined;
    const iconKey = typeEntry?.icon ?? (currentPoint ? currentPoint.type : 'UKN');
    const iconUrl = getItemIconUrl(iconKey);
    const isFilesType = typeEntry?.category?.main === 'files';

    const tGame = useTranslateGame();
    const tUI = useTranslateUI();
    const locale = useLocale();
    const pointNameRaw = tGame(`markerType.key.${currentPoint?.type}`);
    const pointName = typeof pointNameRaw === 'string' && pointNameRaw.trim()
        ? pointNameRaw
        : (currentPoint?.type ?? '');
    const { copiedPopupVisible, copyPointShareUrl } = usePointShareLink(currentPoint);
    const collectionRateText = globalCollectionRate.rate === null
        ? '--'
        : `${(globalCollectionRate.rate * 100).toFixed(1)}%`;
    const collectionRatePopover = globalCollectionRate.rate === null
        ? ''
        : (tUI('detail.collectionRateSource') || 'Global collection rate is {nums} – Statistics from OEM Cloud')
            .replace('{nums}', collectionRateText);
    const [activeTab, setActiveTab] = useState<DetailTab>('general');

    // Archive full-text state — content may be plain text and/or HTML (<i>, <del>, <img>, …)
    const [hasFullText, setHasFullText] = useState(false);
    const [textModalOpen, setTextModalOpen] = useState(false);
    const [fullTextContent, setFullTextContent] = useState<string | null>(null);
    const [isLoadingFullText, setIsLoadingFullText] = useState(false);
    const [highlightComment, setHighlightComment] = useState<UGCComment | null>(null);
    const setHighlightComments = useCallback((action: React.SetStateAction<UGCComment[]>) => {
        setHighlightComment((current) => {
            const currentItems = current ? [current] : [];
            const nextItems = typeof action === 'function' ? action(currentItems) : action;
            return nextItems[0] ?? null;
        });
    }, []);

    useAutoTrans({
        comments: highlightComment ? [highlightComment] : [],
        enabled: Boolean(highlightComment),
        locale,
        scopeKey: currentPointId ? `general:${currentPointId}` : '',
        setComments: setHighlightComments,
    });

    // GET + validate JSON (HEAD is unreliable: Vite may return 200 + index.html for missing paths)
    useEffect(() => {
        setHasFullText(false);
        setFullTextContent(null);
        setTextModalOpen(false);
        if (!isFilesType || !currentPoint) return;
        const url = getFileContentUrl(locale, currentPoint.type);
        const controller = new AbortController();
        fetchArchiveFile(url, controller.signal)
            .then((res) => parseArchiveJsonResponse(res))
            .then((content) => {
                if (controller.signal.aborted) return;
                if (content !== null) {
                    setHasFullText(true);
                    setFullTextContent(content);
                }
            })
            .catch(() => { /* network / abort */ });
        return () => controller.abort();
    }, [isFilesType, currentPoint, locale]);

    useEffect(() => {
        setHighlightComment(null);
        if (!currentPointId) return undefined;

        let disposed = false;
        void listUGCComments(currentPointId)
            .then((comments) => {
                if (!disposed) setHighlightComment(getTopRatedComment(comments));
            })
            .catch(() => {
                if (!disposed) setHighlightComment(null);
            });

        return () => {
            disposed = true;
        };
    }, [currentPointId]);

    const handleOpenFullText = useCallback(async () => {
        if (!currentPoint) return;
        setTextModalOpen(true);
        if (fullTextContent !== null) return; // already loaded by effect
        setIsLoadingFullText(true);
        try {
            const url = getFileContentUrl(locale, currentPoint.type);
            const res = await fetchArchiveFile(url);
            const content = await parseArchiveJsonResponse(res);
            if (content !== null) setFullTextContent(content);
        } catch { /* ignore */ } finally {
            setIsLoadingFullText(false);
        }
    }, [currentPoint, locale, fullTextContent]);

    const archiveJsonUrl = useMemo(
        () => (isFilesType && currentPoint ? getFileContentUrl(locale, currentPoint.type) : ''),
        [isFilesType, currentPoint, locale],
    );

    const fullTextDom = useMemo(() => {
        if (fullTextContent == null) return null;
        const options = createArchiveHtmlParserOptions(archiveJsonUrl);
        return fullTextContent.split(/\r?\n/).map((line, i) => (
            <p key={i}>
                {line.trim() ? parse(line, options) : null}
            </p>
        ));
    }, [fullTextContent, archiveJsonUrl]);

    // const noteContent = currentPoint?.status?.user?.localNote;
    const [detailPhase, setDetailPhase] = useState<DetailPhase>('hidden');
    const ref = useRef<HTMLDivElement | null>(null);
    const headerRef = useRef<HTMLDivElement | null>(null);
    const tabsRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const generalPanelRef = useRef<HTMLDivElement | null>(null);
    const commentsPanelRef = useRef<HTMLDivElement | null>(null);
    const tabSwipeBoundsRef = useRef<TabSwipeBounds | null>(null);
    const tabTouchGestureRef = useRef<TabTouchGesture | null>(null);
    const indicatorResetTimerRef = useRef<number | undefined>(undefined);
    const [hasOpenedComments, setHasOpenedComments] = useState(false);
    const updateDetailHeight = useCallback(() => {
        const container = ref.current;
        const header = headerRef.current;
        const tabs = tabsRef.current;
        const content = contentRef.current;
        const activePanel = activeTab === 'comments' ? commentsPanelRef.current : generalPanelRef.current;
        if (!container || !header || !tabs || !content || !activePanel || typeof window === 'undefined') return;

        const headerHeight = header.getBoundingClientRect().height;
        const tabsHeight = tabs.getBoundingClientRect().height;
        const commentsList = activeTab === 'comments'
            ? activePanel.querySelector<HTMLElement>('[data-comment-list="true"]')
            : null;
        const commentsPanel = commentsList?.parentElement instanceof HTMLElement ? commentsList.parentElement : null;
        const commentsPanelMinHeight = commentsPanel
            ? parseCssPixelValue(window.getComputedStyle(commentsPanel).minHeight)
            : 0;
        const activePanelHeight = commentsList
            ? Math.max(getElementNaturalHeight(commentsList), commentsPanelMinHeight)
            : activePanel.scrollHeight;
        const naturalHeight = headerHeight + tabsHeight + activePanelHeight;
        const maxHeight = Math.max(0, Math.min(window.innerHeight * 0.8, getElementMaxHeight(container)));
        const nextHeight = Math.ceil(Math.min(naturalHeight, maxHeight));
        container.style.setProperty('--detail-panel-height', `${nextHeight}px`);
        container.style.setProperty('--detail-content-height', `${Math.max(0, nextHeight - headerHeight - tabsHeight)}px`);
    }, [activeTab]);
    
    // 当 currentPoint 更新时，显示 detail
    useEffect(() => {
        if (currentPoint) {
            setDetailPhase((phase) => (phase === 'hidden' || phase === 'exiting' ? 'entering' : phase));
        }
    }, [currentPoint]);

    // const handleNextPoint = () => addPoint(currentPoint.id);

    // marks
    const worldCnt = useWorldMarkerCount(currentPoint?.type);
    const regionCnt = useRegionMarkerCount(currentPoint?.type);
    const subCnt = useSubregionMarkerCount(currentPoint?.type, currentPoint?.subregId);

    const statItems = useMemo(
        () => [
            { label: tUI('detail.stat.world'), data: worldCnt, index: 0 },
            { label: tUI('detail.stat.main'), data: regionCnt, index: 1 },
            { label: tUI('detail.stat.sub'), data: subCnt, index: 2 },
        ],
        [worldCnt, regionCnt, subCnt, tUI],
    );

    useLayoutEffect(() => {
        if (!currentPoint || detailPhase === 'hidden') return;
        updateDetailHeight();
    }, [
        currentPoint,
        detailPhase,
        activeTab,
        hasFullText,
        highlightComment,
        pointName,
        statItems,
        updateDetailHeight,
    ]);

    useEffect(() => {
        if (detailPhase !== 'entering') return undefined;
        updateDetailHeight();
        const raf = window.requestAnimationFrame(() => {
            setDetailPhase('open');
        });
        return () => window.cancelAnimationFrame(raf);
    }, [detailPhase, updateDetailHeight]);

    useEffect(() => {
        if (detailPhase !== 'exiting') return undefined;
        const timer = window.setTimeout(() => {
            setDetailPhase('hidden');
        }, DETAIL_EXIT_DURATION_MS);
        return () => window.clearTimeout(timer);
    }, [detailPhase]);

    useEffect(() => {
        if (detailPhase === 'hidden' || typeof ResizeObserver === 'undefined') return undefined;
        const resizeObserver = new ResizeObserver(() => updateDetailHeight());
        if (headerRef.current) resizeObserver.observe(headerRef.current);
        if (tabsRef.current) resizeObserver.observe(tabsRef.current);
        if (generalPanelRef.current) resizeObserver.observe(generalPanelRef.current);
        if (commentsPanelRef.current) resizeObserver.observe(commentsPanelRef.current);
        return () => resizeObserver.disconnect();
    }, [detailPhase, updateDetailHeight]);

    useEffect(() => {
        if (detailPhase === 'hidden' || typeof MutationObserver === 'undefined') return undefined;
        let frameId: number | undefined;
        const scheduleUpdate = () => {
            if (frameId) window.cancelAnimationFrame(frameId);
            frameId = window.requestAnimationFrame(() => {
                frameId = undefined;
                updateDetailHeight();
            });
        };
        const mutationObserver = new MutationObserver(scheduleUpdate);
        if (generalPanelRef.current) {
            mutationObserver.observe(generalPanelRef.current, {
                attributes: true,
                childList: true,
                characterData: true,
                subtree: true,
            });
        }
        if (commentsPanelRef.current) {
            mutationObserver.observe(commentsPanelRef.current, {
                attributes: true,
                childList: true,
                characterData: true,
                subtree: true,
            });
        }
        return () => {
            if (frameId) window.cancelAnimationFrame(frameId);
            mutationObserver.disconnect();
        };
    }, [detailPhase, updateDetailHeight]);

    useEffect(() => {
        if (detailPhase === 'hidden') return undefined;
        window.addEventListener('resize', updateDetailHeight);
        return () => window.removeEventListener('resize', updateDetailHeight);
    }, [detailPhase, updateDetailHeight]);

    useEffect(() => {
        contentRef.current?.scrollTo({ top: 0 });
        generalPanelRef.current?.scrollTo({ top: 0 });
        commentsPanelRef.current?.scrollTo({ top: 0 });
        setActiveTab('general');
        setHasOpenedComments(false);
    }, [currentPoint?.id]);

    const openCommentsTab = useCallback(() => {
        setHasOpenedComments(true);
        setActiveTab('comments');
    }, []);

    const getTabSwipeBounds = useCallback((startTab: DetailTab): TabSwipeBounds | null => {
        const tabs = tabsRef.current;
        const generalTab = tabs?.querySelector<HTMLElement>('[data-tab="general"]');
        const commentsTab = tabs?.querySelector<HTMLElement>('[data-tab="comments"]');
        if (!tabs || !generalTab || !commentsTab) return null;

        const tabsRect = tabs.getBoundingClientRect();
        const generalRect = generalTab.getBoundingClientRect();
        const commentsRect = commentsTab.getBoundingClientRect();
        const relativeCenter = (rect: DOMRect) => rect.left - tabsRect.left + rect.width / 2;
        const generalCenter = relativeCenter(generalRect);
        const commentsCenter = relativeCenter(commentsRect);
        const targetTab: DetailTab = startTab === 'general' ? 'comments' : 'general';
        const targetRect = targetTab === 'comments' ? commentsRect : generalRect;

        return {
            startCenter: startTab === 'general' ? generalCenter : commentsCenter,
            targetTab,
            targetStart: targetRect.left - tabsRect.left,
            targetEnd: targetRect.right - tabsRect.left,
            minCenter: Math.min(generalCenter, commentsCenter),
            maxCenter: Math.max(generalCenter, commentsCenter),
        };
    }, []);

    const settleTabIndicator = useCallback((targetTab: DetailTab) => {
        const tabs = tabsRef.current;
        const target = tabs?.querySelector<HTMLElement>(`[data-tab="${targetTab}"]`);
        if (!tabs || !target) return;

        if (indicatorResetTimerRef.current) window.clearTimeout(indicatorResetTimerRef.current);
        const tabsRect = tabs.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const targetCenter = targetRect.left - tabsRect.left + targetRect.width / 2;
        delete tabs.dataset.swiping;
        tabs.style.setProperty('--detail-tab-indicator-left', `${targetCenter}px`);
        indicatorResetTimerRef.current = window.setTimeout(() => {
            tabs.style.removeProperty('--detail-tab-indicator-left');
            indicatorResetTimerRef.current = undefined;
        }, TAB_INDICATOR_SETTLE_MS);
    }, []);

    useEffect(() => {
        const content = contentRef.current;
        if (!inline || detailPhase !== 'open' || !content) return undefined;

        const findTouch = (touches: TouchList, identifier: number): Touch | null => {
            for (let index = 0; index < touches.length; index += 1) {
                const touch = touches.item(index);
                if (touch?.identifier === identifier) return touch;
            }
            return null;
        };

        const handleTouchStart = (event: TouchEvent) => {
            if (event.touches.length !== 1) return;
            const touch = event.touches.item(0);
            const bounds = getTabSwipeBounds(activeTab);
            if (!touch || !bounds) return;

            if (indicatorResetTimerRef.current) window.clearTimeout(indicatorResetTimerRef.current);
            tabsRef.current?.style.removeProperty('--detail-tab-indicator-left');
            tabSwipeBoundsRef.current = bounds;
            tabTouchGestureRef.current = {
                identifier: touch.identifier,
                startX: touch.clientX,
                startY: touch.clientY,
                intent: 'pending',
                indicatorLeft: bounds.startCenter,
            };
        };

        const handleTouchMove = (event: TouchEvent) => {
            const gesture = tabTouchGestureRef.current;
            const bounds = tabSwipeBoundsRef.current;
            const tabs = tabsRef.current;
            if (!gesture || !bounds || !tabs) return;

            const touch = findTouch(event.touches, gesture.identifier);
            if (!touch) return;
            const movementX = touch.clientX - gesture.startX;
            const movementY = touch.clientY - gesture.startY;

            if (gesture.intent === 'pending') {
                if (Math.max(Math.abs(movementX), Math.abs(movementY)) < 10) return;
                gesture.intent = Math.abs(movementX) > Math.abs(movementY) * 1.15
                    ? 'horizontal'
                    : 'vertical';
            }
            if (gesture.intent !== 'horizontal') return;

            gesture.indicatorLeft = Math.max(
                bounds.minCenter,
                Math.min(bounds.maxCenter, bounds.startCenter - movementX),
            );
            tabs.dataset.swiping = 'true';
            tabs.style.setProperty('--detail-tab-indicator-left', `${gesture.indicatorLeft}px`);
        };

        const finishTouch = (event: TouchEvent, allowSwitch: boolean) => {
            const gesture = tabTouchGestureRef.current;
            const bounds = tabSwipeBoundsRef.current;
            if (!gesture || findTouch(event.changedTouches, gesture.identifier) === null) return;

            tabTouchGestureRef.current = null;
            tabSwipeBoundsRef.current = null;
            if (gesture.intent !== 'horizontal' || !bounds) return;

            const reachedTarget = allowSwitch
                && gesture.indicatorLeft >= bounds.targetStart
                && gesture.indicatorLeft <= bounds.targetEnd;
            const settledTab = reachedTarget ? bounds.targetTab : activeTab;
            settleTabIndicator(settledTab);

            if (!reachedTarget) return;
            if (settledTab === 'comments') {
                openCommentsTab();
            } else {
                setActiveTab('general');
            }
        };

        const handleTouchEnd = (event: TouchEvent) => finishTouch(event, true);
        const handleTouchCancel = (event: TouchEvent) => finishTouch(event, false);
        content.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
        content.addEventListener('touchmove', handleTouchMove, { capture: true, passive: true });
        content.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true });
        content.addEventListener('touchcancel', handleTouchCancel, { capture: true, passive: true });

        return () => {
            content.removeEventListener('touchstart', handleTouchStart, true);
            content.removeEventListener('touchmove', handleTouchMove, true);
            content.removeEventListener('touchend', handleTouchEnd, true);
            content.removeEventListener('touchcancel', handleTouchCancel, true);
            tabTouchGestureRef.current = null;
            tabSwipeBoundsRef.current = null;
        };
    }, [activeTab, detailPhase, getTabSwipeBounds, inline, openCommentsTab, settleTabIndicator]);

    useEffect(() => () => {
        if (indicatorResetTimerRef.current) window.clearTimeout(indicatorResetTimerRef.current);
    }, []);

    const handleHighlightCommentKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openCommentsTab();
    }, [openCommentsTab]);

    const isRegionTypeComplete = currentPoint
        ? regionCnt.total > 0 && regionCnt.collected >= regionCnt.total
        : false;

    const handleCollectAllInRegion = useCallback(async () => {
        if (!currentPoint || !currentRegion || isRegionTypeComplete) return;

        let regionMarkers = getLoadedRegionMarkers(currentRegion);
        if (regionMarkers.length === 0) {
            regionMarkers = await loadRegionMarkers(currentRegion);
            useMarkerStore.getState().bumpMarkerDataVersion();
        }

        const typeMarkerIds = regionMarkers
            .filter((marker) => marker.type === currentPoint.type)
            .map((marker) => marker.id);
        if (typeMarkerIds.length === 0) return;

        commitPointProgress(`Collect ${typeMarkerIds.length} markers of type ${currentPoint.type}`, {
            collect: typeMarkerIds,
        });
    }, [currentPoint, currentRegion, isRegionTypeComplete]);

    return (
        <>
            {detailPhase !== 'hidden' && currentPoint && (
                <div
                    data-state={detailPhase === 'open' ? 'open' : 'closed'}
                    data-drawer-drag-ignore="true"
                    className={classNames(
                        styles.detailContainer,
                        {
                            [styles.inline]: inline,
                        },
                        className,
                    )}
                    ref={ref}
                >
                    {/* Head */}
                    <div className={styles.detailHeader} ref={headerRef}>
                        <div className={styles.pointInfo}>
                            {CategoryIcon && (
                                <span className={styles.categoryIcon}>
                                    <CategoryIcon className={styles.icon} />
                                </span>
                            )}
                            <OverflowPopoverText
                                text={pointName}
                                className={styles.pointName}
                            />
                        </div>
                        <div className={styles.headerActions}>
                            <Button
                                text={tUI('common.close')}
                                aria-label={tUI('common.close')}
                                buttonType='close'
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setDetailPhase('exiting');
                                }}
                            />
                        </div>
                    </div>
                    <div
                        className={styles.detailTabs}
                        role="tablist"
                        data-active-tab={activeTab}
                        ref={tabsRef}
                    >
                        <PopoverTooltip content={tUI('detail.tabs.collectAll')} placement="top" gap={4}>
                            <button
                                type="button"
                                className={classNames(styles.collectAllTab, {
                                    [styles.disabled]: isRegionTypeComplete,
                                })}
                                aria-disabled={isRegionTypeComplete}
                                aria-label={tUI('detail.tabs.collectAll')}
                                onClick={() => void handleCollectAllInRegion()}
                            >
                                <CollectAllIcon />
                            </button>
                        </PopoverTooltip>
                        <button
                            type="button"
                            className={classNames(styles.detailTab, {
                                [styles.active]: activeTab === 'general',
                            })}
                            role="tab"
                            aria-selected={activeTab === 'general'}
                            data-tab="general"
                            onClick={() => setActiveTab('general')}
                        >
                            <GeneralInfoIcon />
                            <span>{tUI('detail.tabs.general')}</span>
                        </button>
                        <button
                            type="button"
                            className={classNames(styles.detailTab, {
                                [styles.active]: activeTab === 'comments',
                            })}
                            role="tab"
                            aria-selected={activeTab === 'comments'}
                            data-tab="comments"
                            onClick={openCommentsTab}
                        >
                            <CommentIcon />
                            <span>{tUI('detail.tabs.comments')}</span>
                        </button>
                    </div>
                    {/* Content */}
                    <div className={styles.detailContent} ref={contentRef}>
                        <div className={styles.detailTabPanel} hidden={activeTab !== 'general'} ref={generalPanelRef}>
                            {/* Icon & Stats */}
                            <div className={styles.iconStatsContainer}>
                                <div
                                    className={classNames(styles.pointIcon, {
                                        [styles.collected]: isCollected,
                                    })}
                                    onClick={() => {
                                        if (isCollected) {
                                            commitPointProgress(`Uncollect ${currentPoint.id}`, {
                                                uncollect: [currentPoint.id],
                                            });
                                        } else {
                                            commitPointProgress(`Collect ${currentPoint.id}`, {
                                                collect: [currentPoint.id],
                                            });
                                        }
                                    }}
                                >
                                    {iconUrl && (
                                        <img
                                            key={currentPoint?.id ?? 'null'}
                                            src={iconUrl}
                                            alt={pointName}
                                        />
                                    )}
                                </div>
                                <div className={styles.pointStats}>
                                    <div className={styles.statsTxt}>
                                        {statItems.map((item) => (
                                            <div
                                                className={styles.statRow}
                                                key={item.label}
                                                style={{
                                                    transform: `translateY(${3 - item.index * 2}px)`,
                                                }}
                                            >
                                                <span className={styles.statLabel}>
                                                    {item.label}:{' '}
                                                </span>
                                                <div className={styles.statValue}>
                                                    <span
                                                        className={`user-value ${item.data.collected === item.data.total ? 'check' : ''}`}
                                                    >
                                                        {item.data.collected}
                                                    </span>
                                                    <span className='value-separator'>
                                                        /
                                                    </span>
                                                    <span className='total-value'>
                                                        {item.data.total}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className={styles.statsProg}>
                                        {statItems.map((item) => (
                                            <div
                                                key={`prog-${item.label}`}
                                                className={classNames(
                                                    styles.progBar,
                                                    {
                                                        [styles.check]:
                                                            item.data.collected ===
                                                            item.data.total,
                                                    },
                                                )}
                                                style={{
                                                    '--prog':
                                                        item.data.total > 0
                                                            ? item.data.collected / item.data.total
                                                            : 0,
                                                }}
                                            ></div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <Uploader point={currentPoint} pointName={pointName} active={detailPhase === 'open' && activeTab === 'general'} />
                            {highlightComment && (
                                <>
                                    <div className={styles.detailDivider} data-label={tUI('detail.label.comments')}></div>
                                    <div
                                        className={styles.highlightCommentLink}
                                        role="button"
                                        tabIndex={0}
                                        onClick={openCommentsTab}
                                        onKeyDown={handleHighlightCommentKeyDown}
                                        aria-label={tUI('detail.tabs.comments')}
                                    >
                                        <CommentExcerpt comment={highlightComment} />
                                    </div>
                                </>
                            )}
                            {hasFullText && (
                                <>
                                    <div className={styles.detailDivider} data-label={tUI('detail.label.note')}></div>
                                    <div className={styles.detailAction}>
                                        <a
                                            onClick={() => void handleOpenFullText()}
                                            role="button"
                                        >
                                            {tUI('detail.readFullText')}
                                        </a>
                                    </div>
                                </>
                            )}
                            <div className={styles.detailDivider} data-label={tUI('detail.label.url')}></div>
                            <div className={styles.detailAction}>
                                <PopoverTooltip
                                    content={tUI('detail.copied')}
                                    placement="top"
                                    gap={4}
                                    visible={copiedPopupVisible}
                                    disabled={false}
                                >
                                    <a
                                        onClick={() => void copyPointShareUrl()}
                                        role="button"
                                    >
                                        {tUI('detail.share')}
                                    </a>
                                </PopoverTooltip>
                            </div>
                            {isImageUploadable && (
                                <PopoverTooltip
                                    content={collectionRatePopover}
                                    placement="top"
                                    gap={4}
                                    disabled={globalCollectionRate.rate === null}
                                >
                                    <div
                                        className={classNames(styles.detailDivider, styles.collectionRateDivider)}
                                        data-label={tUI('detail.label.collectionRate')}
                                        data-loading={globalCollectionRate.loading ? 'true' : 'false'}
                                        aria-busy={globalCollectionRate.loading}
                                        style={{
                                            '--collection-rate': globalCollectionRate.rate ?? 0,
                                        } as React.CSSProperties}
                                        aria-label={`${tUI('detail.label.collectionRate')} ${collectionRateText}`}
                                    >
                                        <span
                                            className={styles.collectionRateLine}
                                            aria-hidden="true"
                                        >
                                            <span className={styles.collectionRateProgress}>
                                                <span className={styles.collectionRateBar}></span>
                                                <span className={styles.collectionRateValue}>{collectionRateText}</span>
                                            </span>
                                        </span>
                                    </div>
                                </PopoverTooltip>
                            )}
                        </div>
                        <div
                            className={classNames(styles.detailTabPanel, styles.commentsTabPanel)}
                            hidden={activeTab !== 'comments'}
                            ref={commentsPanelRef}
                        >
                            {hasOpenedComments && (
                                <Comments
                                    point={currentPoint}
                                    pointName={pointName}
                                    active={detailPhase === 'open' && activeTab === 'comments'}
                                />
                            )}
                        </div>
                    </div>
                </div>
            )}
        {/* Full-text modal — rendered as a portal, independent of detail visibility */}
        <Modal
            open={textModalOpen}
            title={pointName}
            size="m"
            icon={CategoryIcon ? <CategoryIcon /> : undefined}
            onClose={() => setTextModalOpen(false)}
            iconScale={0.8}
        >
            <div className={styles.fullTextContent}>
                {isLoadingFullText ? null : fullTextDom}
            </div>
        </Modal>
        </>
    );
};

export default Detail;
