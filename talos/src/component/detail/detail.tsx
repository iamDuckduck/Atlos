import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import styles from './detail.module.scss';
import Button from '@/component/button/button';
import Modal from '@/component/modal/modal';
import PopoverTooltip from '@/component/popover/popover';
import Uploader from '../uploader/uploader';
import Comments from './comments';

import parse from 'html-react-parser';
import { getItemIconUrl, getFileContentUrl, fetchArchiveFile } from '@/utils/resource.ts';
import { parseArchiveJsonResponse, createArchiveHtmlParserOptions } from './archiveFullText';
import { getLoadedRegionMarkers, loadRegionMarkers, MARKER_TYPE_DICT } from '@/data/marker';
import { usePointShareLink } from '@/utils/shareLink';
import useRegion from '@/store/region';

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
    useAddPoint,
    useDeletePoint,
    useUserRecord,
    useUserRecordStore,
} from '@/store/userRecord.ts';
import classNames from 'classnames';
import { useTranslateGame, useTranslateUI, useLocale } from '@/locale';
import { useForceDetailOpen } from '@/store/uiPrefs';

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

const DETAIL_EXIT_DURATION_MS = 300;

export const Detail = ({ inline = false }: { inline?: boolean }) => {
    /**
     * @type {import('../mapContainer/store/marker.type').IMarkerData}
     */
    const currentPoint = useMarkerStore((state) => state.currentActivePoint);
    const pointsRecord = useUserRecord();
    const addPoint = useAddPoint();
    const deletePoint = useDeletePoint();
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
    const [activeTab, setActiveTab] = useState<DetailTab>('general');

    // Archive full-text state — content may be plain text and/or HTML (<i>, <del>, <img>, …)
    const [hasFullText, setHasFullText] = useState(false);
    const [textModalOpen, setTextModalOpen] = useState(false);
    const [fullTextContent, setFullTextContent] = useState<string | null>(null);
    const [isLoadingFullText, setIsLoadingFullText] = useState(false);

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
    const forceDetailOpen = useForceDetailOpen();
    const ref = useRef<HTMLDivElement | null>(null);
    const headerRef = useRef<HTMLDivElement | null>(null);
    const tabsRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const contentInnerRef = useRef<HTMLDivElement | null>(null);
    const generalPanelRef = useRef<HTMLDivElement | null>(null);
    const commentsPanelRef = useRef<HTMLDivElement | null>(null);
    const [hasOpenedComments, setHasOpenedComments] = useState(false);
    const updateDetailHeight = useCallback(() => {
        const container = ref.current;
        const header = headerRef.current;
        const tabs = tabsRef.current;
        const content = contentRef.current;
        const activePanel = activeTab === 'comments' ? commentsPanelRef.current : generalPanelRef.current;
        if (!container || !header || !tabs || !content || !activePanel || typeof window === 'undefined') return;

        const contentStyle = window.getComputedStyle(content);
        const contentPadding =
            Number.parseFloat(contentStyle.paddingTop || '0') +
            Number.parseFloat(contentStyle.paddingBottom || '0');
        const naturalHeight = header.getBoundingClientRect().height + tabs.getBoundingClientRect().height + contentPadding + activePanel.scrollHeight;
        const maxHeight = Math.max(0, window.innerHeight * 0.8);
        const nextHeight = Math.ceil(Math.min(naturalHeight, maxHeight));
        container.style.setProperty('--detail-panel-height', `${nextHeight}px`);
    }, [activeTab]);
    
    // 当 currentPoint 更新时，显示 detail
    useEffect(() => {
        if (currentPoint) {
            console.log('[Detail] currentPoint changed:', currentPoint, 'forceDetailOpen:', forceDetailOpen);
            setDetailPhase((phase) => (phase === 'hidden' || phase === 'exiting' ? 'entering' : phase));
        }
    }, [currentPoint, forceDetailOpen]);

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
        if (contentInnerRef.current) resizeObserver.observe(contentInnerRef.current);
        return () => resizeObserver.disconnect();
    }, [detailPhase, updateDetailHeight]);

    useEffect(() => {
        if (detailPhase === 'hidden') return undefined;
        window.addEventListener('resize', updateDetailHeight);
        return () => window.removeEventListener('resize', updateDetailHeight);
    }, [detailPhase, updateDetailHeight]);

    useEffect(() => {
        contentRef.current?.scrollTo({ top: 0 });
        setActiveTab('general');
        setHasOpenedComments(false);
    }, [currentPoint?.id]);

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

        const currentIds = useUserRecordStore.getState().activePoints;
        useUserRecordStore.getState().setPoints([...currentIds, ...typeMarkerIds]);
    }, [currentPoint, currentRegion, isRegionTypeComplete]);

    return (
        <>
            {detailPhase !== 'hidden' && currentPoint && (
                <div
                    data-state={detailPhase === 'open' ? 'open' : 'closed'}
                    className={classNames(styles.detailContainer, {
                        [styles.inline]: inline,
                    })}
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
                            <span className={styles.pointName}>{pointName}</span>
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
                    <div className={styles.detailTabs} role="tablist" aria-label={tUI('detail.tabs.title')} ref={tabsRef}>
                        <button
                            type="button"
                            className={classNames(styles.collectAllTab, {
                                [styles.disabled]: isRegionTypeComplete,
                            })}
                            disabled={isRegionTypeComplete}
                            onClick={() => void handleCollectAllInRegion()}
                            aria-label={tUI('detail.tabs.collectAll')}
                            title={tUI('detail.tabs.collectAll')}
                        >
                            <CollectAllIcon />
                        </button>
                        <button
                            type="button"
                            className={classNames(styles.detailTab, {
                                [styles.active]: activeTab === 'general',
                            })}
                            role="tab"
                            aria-selected={activeTab === 'general'}
                            onClick={() => setActiveTab('general')}
                        >
                            <GeneralInfoIcon />
                            {tUI('detail.tabs.general')}
                        </button>
                        <button
                            type="button"
                            className={classNames(styles.detailTab, {
                                [styles.active]: activeTab === 'comments',
                            })}
                            role="tab"
                            aria-selected={activeTab === 'comments'}
                            onClick={() => {
                                setHasOpenedComments(true);
                                setActiveTab('comments');
                            }}
                        >
                            <CommentIcon />
                            {tUI('detail.tabs.comments')}
                        </button>
                    </div>
                    {/* Content */}
                    <div className={styles.detailContent} ref={contentRef}>
                        <div className={styles.detailContentInner} ref={contentInnerRef}>
                            <div className={styles.detailTabPanel} hidden={activeTab !== 'general'} ref={generalPanelRef}>
                                {/* Icon & Stats */}
                                <div className={styles.iconStatsContainer}>
                                    <div
                                        className={classNames(styles.pointIcon, {
                                            [styles.collected]: isCollected,
                                        })}
                                        onClick={() => {
                                            if (isCollected) {
                                                deletePoint(currentPoint.id);
                                            } else {
                                                addPoint(currentPoint.id);
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
                            </div>
                            <div className={styles.detailTabPanel} hidden={activeTab !== 'comments'} ref={commentsPanelRef}>
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
