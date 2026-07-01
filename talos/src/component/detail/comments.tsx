import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { LinearBlur } from 'progressive-blur';
import styles from './comments.module.scss';
import { openOemAuthModal } from '@/component/login/authEvents';
import { useAuthStore } from '@/store/auth';
import type { SessionUser } from '@/component/login/authTypes';
import { useLocale, useTranslateUI } from '@/locale';
import { formatRelativeTime, parseDateLike } from '@/utils/timeFormat';
import type { IMarkerData } from '@/data/marker';
import {
    invalidateUGCCommentCache,
    listUGCComments,
    recallUGCComment,
    requestUGCCommentRemoval,
    submitUGCComment,
    toggleUGCCommentFlag,
    translateUGCComments,
    voteUGCComment,
    type UGCComment,
    type UGCCommentActionPatch,
    type UGCCommentSubmission,
    type UGCCommentVoteValue,
    type UGCSubmissionStatus,
} from '@/utils/ugcClient';
import ShortActions, { type ShortActionItem } from '@/component/uploader/shortActions';
import TranslateIcon from '@/assets/logos/translater.svg?react';
import LikeIcon from '@/assets/images/UI/like.svg?react';
import FlagIcon from '@/assets/images/UI/flag.svg?react';
import RecallIcon from '@/assets/images/UI/recall.svg?react';
import SubmitIcon from '@/assets/logos/submit.svg?react';
import ReplyIcon from '@/assets/logos/comment.svg?react';

type Props = {
    point: IMarkerData;
    pointName: string;
    active?: boolean;
};

const COMMENT_MAX_LENGTH = 200;
const COMMENT_TOGGLE_SYNC_DELAY_MS = 300;
const COMMENT_MAX_DISPLAY_DEPTH = 2;
const COMMENT_REPLY_QUOTE_TRANSITION_MS = 180;

type CommentSyncTask<T> = {
    desired: T;
    inFlight: boolean;
    lastSynced: T;
    timer?: number;
};

type DisplayComment = {
    comment: UGCComment;
    displayDepth: number;
};

const isVisibleStatus = (status: UGCSubmissionStatus | undefined): boolean => (
    status === 'active' || status === 'flagged' || status === 'remove_request'
);

const isReviewingStatus = (status: UGCSubmissionStatus | undefined): boolean => (
    status === 'pending_openai' || status === 'pending_audit'
);

const getCommentAvatarIndex = (comment: UGCComment): number | undefined => {
    const authorAvatar = comment.author?.avatar;
    if (!Number.isFinite(authorAvatar)) return undefined;

    const avatarIndex = Math.floor(authorAvatar as number);
    return avatarIndex >= 1 ? avatarIndex : undefined;
};

const flattenCommentIds = (comments: UGCComment[]): string[] => (
    comments.flatMap((comment) => [comment.id, ...flattenCommentIds(comment.replies ?? [])])
);

const collectCommentIds = (comment: UGCComment): string[] => (
    [comment.id, ...(comment.replies ?? []).flatMap(collectCommentIds)]
);

const flattenDisplayComments = (
    comments: UGCComment[],
    depth = 0,
): DisplayComment[] => (
    comments.flatMap((comment) => [
        {
            comment,
            displayDepth: Math.min(depth, COMMENT_MAX_DISPLAY_DEPTH),
        },
        ...flattenDisplayComments(comment.replies ?? [], depth + 1),
    ])
);

const createPendingComment = (
    point: IMarkerData,
    content: string,
    submission: UGCCommentSubmission,
    user: SessionUser | null,
): UGCComment => ({
    id: submission.id,
    markerId: submission.markerId,
    poiHash: undefined,
    poiType: point.type,
    parentId: submission.parentId,
    depth: submission.depth,
    content,
    author: user
        ? {
            nickname: user.nickname,
            publicUid: user.uid,
            avatar: user.avatar,
        }
        : null,
    createdAt: new Date().toISOString(),
    score: 0,
    viewerVote: 0,
    flagged: false,
    recallRequested: false,
    status: submission.status,
    replyCount: 0,
    replies: [],
});

const appendSubmittedComment = (comments: UGCComment[], comment: UGCComment): UGCComment[] => {
    if (!comment.parentId) {
        return [comment, ...comments];
    }

    const appendToParent = (items: UGCComment[]): [UGCComment[], boolean] => {
        let inserted = false;
        const nextItems = items.map((item) => {
            if (item.id === comment.parentId) {
                inserted = true;
                return {
                    ...item,
                    replyCount: item.replyCount + 1,
                    replies: [...(item.replies ?? []), comment],
                };
            }

            const replies = item.replies ?? [];
            if (replies.length === 0) return item;
            const [nextReplies, childInserted] = appendToParent(replies);
            if (!childInserted) return item;
            inserted = true;
            return {
                ...item,
                replies: nextReplies,
            };
        });

        return inserted ? [nextItems, true] : [items, false];
    };

    const [nextComments, inserted] = appendToParent(comments);
    return inserted ? nextComments : [comment, ...comments];
};

const removeCommentTree = (
    comments: UGCComment[],
    commentId: string,
): {
    comments: UGCComment[];
    removed: UGCComment | null;
    removedIds: Set<string>;
} => {
    let removed: UGCComment | null = null;

    const removeFromItems = (items: UGCComment[]): [UGCComment[], boolean, boolean] => {
        let changed = false;
        let removedDirectChild = false;
        const nextItems: UGCComment[] = [];

        items.forEach((item) => {
            if (item.id === commentId) {
                removed = item;
                changed = true;
                removedDirectChild = true;
                return;
            }

            const replies = item.replies ?? [];
            if (replies.length === 0) {
                nextItems.push(item);
                return;
            }

            const [nextReplies, childChanged, childRemovedDirectChild] = removeFromItems(replies);
            if (!childChanged) {
                nextItems.push(item);
                return;
            }

            changed = true;
            nextItems.push({
                ...item,
                replyCount: childRemovedDirectChild ? Math.max(0, item.replyCount - 1) : item.replyCount,
                replies: nextReplies,
            });
        });

        return changed ? [nextItems, true, removedDirectChild] : [items, false, false];
    };

    const [nextComments] = removeFromItems(comments);
    return {
        comments: nextComments,
        removed,
        removedIds: new Set(removed ? collectCommentIds(removed) : []),
    };
};

const patchCommentTree = (
    comments: UGCComment[],
    commentId: string,
    patch: (comment: UGCComment) => UGCComment,
): UGCComment[] => (
    comments.map((comment) => {
        if (comment.id === commentId) {
            return patch(comment);
        }

        const replies = comment.replies ?? [];
        if (replies.length === 0) return comment;
        const nextReplies = patchCommentTree(replies, commentId, patch);
        return nextReplies === replies ? comment : { ...comment, replies: nextReplies };
    })
);

const applyCommentPatch = (comment: UGCComment, patch: UGCCommentActionPatch): UGCComment => ({
    ...comment,
    ...patch,
    recallRequested: patch.recallRequested ?? comment.recallRequested,
    replies: comment.replies,
});

const getCommentStatusLabel = (comment: UGCComment, timeLabel: string): string => {
    if (isReviewingStatus(comment.status)) return 'Reviewing';
    return timeLabel;
};

const getLocaleLanguageCode = (locale: string): string => (
    locale.toLowerCase().replace('_', '-')
);

const getVoteDelta = (current: UGCCommentVoteValue | undefined, next: UGCCommentVoteValue): number => (
    next - (current ?? 0)
);

const parseCssPixelValue = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const getCommentSyncTask = <T,>(
    tasks: Map<string, CommentSyncTask<T>>,
    commentId: string,
    currentValue: T,
): CommentSyncTask<T> => {
    const current = tasks.get(commentId);
    if (current) return current;
    const task = {
        desired: currentValue,
        inFlight: false,
        lastSynced: currentValue,
    };
    tasks.set(commentId, task);
    return task;
};

const getVoteRequestValue = (
    lastSynced: UGCCommentVoteValue,
    desired: UGCCommentVoteValue,
): 1 | -1 | null => {
    if (desired === 1 || desired === -1) return desired;
    if (lastSynced === 1 || lastSynced === -1) return lastSynced;
    return null;
};

const CommentAvatar = memo(({ comment }: { comment: UGCComment }) => (
    <span className={styles.commentAvatar} data-avt={getCommentAvatarIndex(comment)} aria-hidden="true"></span>
));

CommentAvatar.displayName = 'CommentAvatar';

type CommentExcerptProps = {
    comment: UGCComment;
    displayDepth?: number;
    actions?: React.ReactNode;
};

export const CommentExcerpt = memo(({
    comment,
    displayDepth = 0,
    actions,
}: CommentExcerptProps) => {
    const tUI = useTranslateUI();
    const createdAt = useMemo(() => parseDateLike(comment.createdAt), [comment.createdAt]);
    const timeLabel = createdAt
        ? formatRelativeTime(createdAt, { precision: 'dateTime', agoDisplay: 'hover', agoLabel: tUI('idcard.ago') }).agoText
        : '';
    const statusLabel = getCommentStatusLabel(comment, timeLabel);
    const authorName = comment.author?.nickname || tUI('detail.comments.anonymous');

    return (
        <div
            className={classNames(styles.commentNode, { [styles.replyNode]: displayDepth > 0 })}
            style={{ '--comment-display-depth': displayDepth } as React.CSSProperties}
        >
            <article
                className={styles.commentBubble}
                data-short-actions-root={actions ? 'true' : undefined}
            >
                {actions}
                <div
                    className={classNames(styles.commentMeta, {
                        [styles.reviewing]: isReviewingStatus(comment.status),
                    })}
                    data-status={statusLabel}
                >
                    <CommentAvatar comment={comment} />
                    <span className={styles.commentAuthor}>{authorName}</span>
                </div>
                <p className={styles.commentBody}>
                    {comment.translatedContent || comment.content}
                </p>
            </article>
        </div>
    );
});

CommentExcerpt.displayName = 'CommentExcerpt';

type CommentItemProps = {
    comment: UGCComment;
    displayDepth: number;
    isOwn: boolean;
    canInteract: boolean;
    actionPending: boolean;
    onVote: (comment: UGCComment, value: 1 | -1) => void;
    onFlag: (comment: UGCComment) => void;
    onRecall: (comment: UGCComment) => void;
    onTranslate: (comment: UGCComment) => void;
    onReply: (comment: UGCComment) => void;
};

const CommentItem = memo(({
    comment,
    displayDepth,
    isOwn,
    canInteract,
    actionPending,
    onVote,
    onFlag,
    onRecall,
    onTranslate,
    onReply,
}: CommentItemProps) => {
    const tUI = useTranslateUI();
    const canModerate = isVisibleStatus(comment.status);
    const actions = useMemo<ShortActionItem[]>(() => {
        const items: ShortActionItem[] = [
            {
                id: 'translate',
                label: tUI('detail.comments.translate'),
                icon: <TranslateIcon />,
                disabled: !canInteract || !canModerate || actionPending,
                onClick: () => onTranslate(comment),
            },
            {
                id: 'upvote',
                label: tUI('detail.comments.upvote'),
                icon: <LikeIcon />,
                active: comment.viewerVote === 1,
                disabled: !canInteract || !canModerate || actionPending,
                onClick: () => onVote(comment, 1),
            },
            {
                id: 'downvote',
                label: tUI('detail.comments.downvote'),
                icon: <LikeIcon />,
                active: comment.viewerVote === -1,
                disabled: !canInteract || !canModerate || actionPending,
                onClick: () => onVote(comment, -1),
            },
        ];

        if (!isOwn) {
            items.push({
                id: 'flag',
                label: comment.flagged ? tUI('detail.viewer.unflag') : tUI('detail.viewer.flag'),
                icon: <FlagIcon />,
                active: Boolean(comment.flagged),
                disabled: !canInteract || !canModerate || actionPending,
                tooltipKey: `flag:${comment.flagged ? 'on' : 'off'}:${comment.id}`,
                onClick: () => onFlag(comment),
            });
        }

        if (isOwn) {
            items.push({
                id: 'recall',
                label: tUI('detail.viewer.recall'),
                icon: <RecallIcon />,
                active: Boolean(comment.recallRequested || comment.status === 'remove_request'),
                disabled: !canInteract || actionPending || comment.status === 'stale',
                onClick: () => onRecall(comment),
            });
        }

        items.push({
            id: 'reply',
            label: tUI('detail.comments.reply'),
            icon: <ReplyIcon />,
            disabled: !canInteract || !canModerate || actionPending,
            onClick: () => onReply(comment),
        });

        return items;
    }, [
        actionPending,
        canInteract,
        canModerate,
        comment,
        isOwn,
        onFlag,
        onRecall,
        onReply,
        onTranslate,
        onVote,
        tUI,
    ]);

    return (
        <CommentExcerpt
            comment={comment}
            displayDepth={displayDepth}
            actions={(
                <ShortActions
                    className={styles.commentActions}
                    anchorClassName={styles.commentActionsAnchor}
                    items={actions}
                    ariaLabel={tUI('detail.comments.actions')}
                    variant="floating"
                />
            )}
        />
    );
});

CommentItem.displayName = 'CommentItem';

const Comments = ({ point, pointName, active = true }: Props) => {
    const tUI = useTranslateUI();
    const locale = useLocale();
    const user = useAuthStore((state) => state.sessionUser);
    const isAuthenticated = Boolean(user);
    const [comments, setComments] = useState<UGCComment[]>([]);
    const [loading, setLoading] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [actionPendingIds, setActionPendingIds] = useState<Set<string>>(() => new Set());
    const [error, setError] = useState('');
    const [replyTarget, setReplyTarget] = useState<UGCComment | null>(null);
    const [renderedReplyTarget, setRenderedReplyTarget] = useState<UGCComment | null>(null);
    const [replyQuoteVisible, setReplyQuoteVisible] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const inputBarRef = useRef<HTMLDivElement | null>(null);
    const commentsPanelRef = useRef<HTMLElement | null>(null);
    const commentListRef = useRef<HTMLDivElement | null>(null);
    const voteTasksRef = useRef(new Map<string, CommentSyncTask<UGCCommentVoteValue>>());
    const flagTasksRef = useRef(new Map<string, CommentSyncTask<boolean>>());
    const replyQuoteTimerRef = useRef<number | undefined>(undefined);
    const [commentBottomBlurVisible, setCommentBottomBlurVisible] = useState(false);
    const loadFailedText = tUI('detail.comments.loadFailed');

    const hasComments = comments.length > 0;
    const inputDisabled = !active || submitting;
    const isOwnComment = useCallback((comment: UGCComment): boolean => {
        if (!user) return false;
        return comment.author?.publicUid === user.uid;
    }, [user]);
    useEffect(() => {
        let disposed = false;
        setLoading(true);
        setError('');
        setComments([]);

        void listUGCComments(point.id)
            .then((nextComments) => {
                if (!disposed) setComments(nextComments);
            })
            .catch(() => {
                if (!disposed) {
                    setComments([]);
                    setError(loadFailedText);
                }
            })
            .finally(() => {
                if (!disposed) setLoading(false);
            });

        return () => {
            disposed = true;
        };
    }, [loadFailedText, point.id]);

    useEffect(() => {
        setReplyTarget(null);
    }, [point.id]);

    useEffect(() => {
        if (replyQuoteTimerRef.current) {
            window.clearTimeout(replyQuoteTimerRef.current);
            replyQuoteTimerRef.current = undefined;
        }

        if (replyTarget) {
            setRenderedReplyTarget(replyTarget);
            const frameId = window.requestAnimationFrame(() => setReplyQuoteVisible(true));
            return () => window.cancelAnimationFrame(frameId);
        }

        setReplyQuoteVisible(false);
        replyQuoteTimerRef.current = window.setTimeout(() => {
            setRenderedReplyTarget(null);
            replyQuoteTimerRef.current = undefined;
        }, COMMENT_REPLY_QUOTE_TRANSITION_MS);

        return () => {
            if (replyQuoteTimerRef.current) {
                window.clearTimeout(replyQuoteTimerRef.current);
                replyQuoteTimerRef.current = undefined;
            }
        };
    }, [replyTarget]);

    const setCommentActionPending = useCallback((commentId: string, pending: boolean) => {
        setActionPendingIds((current) => {
            const next = new Set(current);
            if (pending) {
                next.add(commentId);
            } else {
                next.delete(commentId);
            }
            return next;
        });
    }, []);

    const patchComment = useCallback((commentId: string, patch: (comment: UGCComment) => UGCComment) => {
        setComments((current) => patchCommentTree(current, commentId, patch));
    }, []);

    const clearCommentSyncTasks = useCallback((commentIds: Set<string>) => {
        commentIds.forEach((commentId) => {
            const voteTask = voteTasksRef.current.get(commentId);
            if (voteTask?.timer) window.clearTimeout(voteTask.timer);
            voteTasksRef.current.delete(commentId);

            const flagTask = flagTasksRef.current.get(commentId);
            if (flagTask?.timer) window.clearTimeout(flagTask.timer);
            flagTasksRef.current.delete(commentId);
        });
    }, []);

    const updateCommentBottomBlur = useCallback(() => {
        const list = commentListRef.current;
        if (!list) {
            setCommentBottomBlurVisible(false);
            return;
        }

        const overflow = list.scrollHeight - list.clientHeight > 2;
        const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 2;
        setCommentBottomBlurVisible(overflow && !atBottom);
    }, []);

    const resizeInput = useCallback(() => {
        const input = inputRef.current;
        if (!input) return;

        const style = window.getComputedStyle(input);
        const minHeight = parseCssPixelValue(style.minHeight);
        const maxHeight = parseCssPixelValue(style.maxHeight);
        input.style.height = `${minHeight}px`;
        const contentHeight = input.value.length === 0 ? minHeight : input.scrollHeight;
        const nextHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight || contentHeight);
        input.style.height = `${nextHeight}px`;
        input.style.overflowY = input.scrollHeight > nextHeight + 1 ? 'auto' : 'hidden';
    }, []);

    const scheduleVoteSync = useCallback((commentId: string) => {
        const task = voteTasksRef.current.get(commentId);
        if (!task) return;
        if (task.timer) {
            window.clearTimeout(task.timer);
        }
        task.timer = window.setTimeout(() => {
            task.timer = undefined;
            if (task.inFlight) return;
            if (task.desired === task.lastSynced) return;

            const sentState = task.desired;
            const requestValue = getVoteRequestValue(task.lastSynced, sentState);
            if (requestValue === null) {
                task.lastSynced = sentState;
                return;
            }

            task.inFlight = true;
            void voteUGCComment(commentId, requestValue)
                .then((patch) => {
                    task.lastSynced = sentState;
                    if (task.desired === sentState) {
                        patchComment(commentId, (item) => applyCommentPatch(item, patch));
                    }
                })
                .catch(() => {
                    if (task.desired !== sentState) return;
                    task.desired = task.lastSynced;
                    patchComment(commentId, (item) => {
                        const currentVote = item.viewerVote ?? 0;
                        if (currentVote === task.lastSynced) return item;
                        return {
                            ...item,
                            viewerVote: task.lastSynced,
                            score: item.score + getVoteDelta(currentVote, task.lastSynced),
                        };
                    });
                })
                .finally(() => {
                    task.inFlight = false;
                    if (task.desired !== task.lastSynced) {
                        scheduleVoteSync(commentId);
                    }
                });
        }, COMMENT_TOGGLE_SYNC_DELAY_MS);
    }, [patchComment]);

    const scheduleFlagSync = useCallback((commentId: string) => {
        const task = flagTasksRef.current.get(commentId);
        if (!task) return;
        if (task.timer) {
            window.clearTimeout(task.timer);
        }
        task.timer = window.setTimeout(() => {
            task.timer = undefined;
            if (task.inFlight) return;
            if (task.desired === task.lastSynced) return;

            const sentState = task.desired;
            task.inFlight = true;
            void toggleUGCCommentFlag(commentId, sentState)
                .then((patch) => {
                    task.lastSynced = sentState;
                    if (task.desired === sentState) {
                        patchComment(commentId, (item) => applyCommentPatch(item, patch));
                    }
                })
                .catch(() => {
                    if (task.desired !== sentState) return;
                    task.desired = task.lastSynced;
                    patchComment(commentId, (item) => ({
                        ...item,
                        flagged: task.lastSynced,
                        status: task.lastSynced ? 'flagged' : item.status === 'flagged' ? 'active' : item.status,
                    }));
                })
                .finally(() => {
                    task.inFlight = false;
                    if (task.desired !== task.lastSynced) {
                        scheduleFlagSync(commentId);
                    }
                });
        }, COMMENT_TOGGLE_SYNC_DELAY_MS);
    }, [patchComment]);

    useEffect(() => () => {
        voteTasksRef.current.forEach((task) => {
            if (task.timer) window.clearTimeout(task.timer);
        });
        flagTasksRef.current.forEach((task) => {
            if (task.timer) window.clearTimeout(task.timer);
        });
        if (replyQuoteTimerRef.current) {
            window.clearTimeout(replyQuoteTimerRef.current);
        }
    }, []);

    useEffect(() => {
        const list = commentListRef.current;
        if (!list) return undefined;

        const rafId = window.requestAnimationFrame(updateCommentBottomBlur);
        const resizeObserver = typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(updateCommentBottomBlur);
        resizeObserver?.observe(list);

        return () => {
            window.cancelAnimationFrame(rafId);
            resizeObserver?.disconnect();
        };
    }, [
        comments,
        error,
        inputValue,
        loading,
        renderedReplyTarget,
        replyQuoteVisible,
        updateCommentBottomBlur,
    ]);

    useLayoutEffect(() => {
        resizeInput();
    }, [inputValue, renderedReplyTarget, resizeInput]);

    useEffect(() => {
        const inputBar = inputBarRef.current;
        const panel = commentsPanelRef.current;
        if (!inputBar || !panel) return undefined;

        const syncInputHeight = () => {
            panel.style.setProperty('--comment-input-height', `${Math.ceil(inputBar.getBoundingClientRect().height)}px`);
            updateCommentBottomBlur();
        };
        syncInputHeight();

        if (typeof ResizeObserver === 'undefined') return undefined;
        const resizeObserver = new ResizeObserver(syncInputHeight);
        resizeObserver.observe(inputBar);
        return () => resizeObserver.disconnect();
    }, [renderedReplyTarget, replyQuoteVisible, updateCommentBottomBlur]);

    const requireAuth = useCallback(() => {
        if (isAuthenticated) return true;
        openOemAuthModal('login');
        return false;
    }, [isAuthenticated]);

    const handleReply = useCallback((comment: UGCComment) => {
        setReplyTarget(comment);
        window.requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
    }, []);

    const handleSubmit = useCallback(async () => {
        const content = inputValue.trim();
        if (!content || submitting) return;
        if (!requireAuth()) return;
        const parentId = replyTarget?.id ?? null;

        setSubmitting(true);
        setError('');
        try {
            const submission = await submitUGCComment(point, content, parentId);
            setComments((current) => appendSubmittedComment(
                current,
                createPendingComment(point, content, submission, user),
            ));
            setInputValue('');
            setReplyTarget(null);
        } catch {
            setError(tUI('detail.comments.submitFailed'));
        } finally {
            setSubmitting(false);
        }
    }, [inputValue, point, replyTarget, requireAuth, submitting, tUI, user]);

    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (
            event.key === 'Backspace'
            && !event.nativeEvent.isComposing
            && inputValue.length === 0
            && replyTarget
        ) {
            event.preventDefault();
            setReplyTarget(null);
            return;
        }

        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        void handleSubmit();
    }, [handleSubmit, inputValue.length, replyTarget]);

    const handleVote = useCallback((comment: UGCComment, value: 1 | -1) => {
        if (!requireAuth()) return;
        const nextVote: UGCCommentVoteValue = comment.viewerVote === value ? 0 : value;
        const previousVote = comment.viewerVote ?? 0;
        patchComment(comment.id, (item) => ({
            ...item,
            viewerVote: nextVote,
            score: item.score + getVoteDelta(previousVote, nextVote),
        }));
        const task = getCommentSyncTask(voteTasksRef.current, comment.id, previousVote);
        task.desired = nextVote;
        scheduleVoteSync(comment.id);
    }, [patchComment, requireAuth, scheduleVoteSync]);

    const handleFlag = useCallback((comment: UGCComment) => {
        if (!requireAuth()) return;
        const nextFlagged = !comment.flagged;
        patchComment(comment.id, (item) => ({
            ...item,
            flagged: nextFlagged,
            status: nextFlagged ? 'flagged' : item.status === 'flagged' ? 'active' : item.status,
        }));
        const task = getCommentSyncTask(flagTasksRef.current, comment.id, Boolean(comment.flagged));
        task.desired = nextFlagged;
        scheduleFlagSync(comment.id);
    }, [patchComment, requireAuth, scheduleFlagSync]);

    const handleRecall = useCallback((comment: UGCComment) => {
        if (!requireAuth() || actionPendingIds.has(comment.id)) return;
        const previousComments = comments;
        const previousReplyTarget = replyTarget;
        const removal = removeCommentTree(comments, comment.id);
        if (!removal.removed) return;

        setComments(removal.comments);
        setReplyTarget((current) => (current && removal.removedIds.has(current.id) ? null : current));
        invalidateUGCCommentCache(point.id);
        clearCommentSyncTasks(removal.removedIds);
        setCommentActionPending(comment.id, true);
        const request = isReviewingStatus(comment.status)
            ? recallUGCComment(comment.id)
            : requestUGCCommentRemoval(comment.id);
        void request
            .then(() => undefined)
            .catch(() => {
                setComments(previousComments);
                setReplyTarget(previousReplyTarget);
            })
            .finally(() => setCommentActionPending(comment.id, false));
    }, [
        actionPendingIds,
        clearCommentSyncTasks,
        comments,
        point.id,
        replyTarget,
        requireAuth,
        setCommentActionPending,
    ]);

    const handleTranslate = useCallback((comment: UGCComment) => {
        if (actionPendingIds.has(comment.id)) return;
        const targetLanguage = getLocaleLanguageCode(locale);
        setCommentActionPending(comment.id, true);
        void translateUGCComments([comment.id], targetLanguage)
            .then((items) => {
                const item = items.find((entry) => entry.commentId === comment.id);
                if (!item?.translatedContent) return;
                patchComment(comment.id, (current) => ({
                    ...current,
                    translatedContent: item.translatedContent,
                }));
            })
            .finally(() => setCommentActionPending(comment.id, false));
    }, [actionPendingIds, locale, patchComment, setCommentActionPending]);

    const footerText = hasComments
        ? tUI('detail.comments.ruleOnly')
        : tUI('detail.comments.emptyWithRule');
    const allCommentIds = useMemo(() => flattenCommentIds(comments), [comments]);
    const displayComments = useMemo(() => flattenDisplayComments(comments), [comments]);
    const replyQuoteShown = Boolean(renderedReplyTarget && replyQuoteVisible);
    const replyQuoteText = renderedReplyTarget
        ? renderedReplyTarget.translatedContent || renderedReplyTarget.content
        : '';

    return (
        <section
            ref={commentsPanelRef}
            className={styles.commentsPanel}
            data-replying={replyQuoteShown ? 'true' : 'false'}
            aria-label={`${pointName} ${tUI('detail.comments.title')}`}
        >
            <div
                className={styles.commentList}
                data-loading={loading ? 'true' : 'false'}
                data-comment-list="true"
                ref={commentListRef}
                onScroll={updateCommentBottomBlur}
            >
                {displayComments.map(({ comment, displayDepth }) => (
                    <CommentItem
                        key={comment.id}
                        comment={comment}
                        displayDepth={displayDepth}
                        isOwn={isOwnComment(comment)}
                        canInteract={active}
                        actionPending={actionPendingIds.has(comment.id)}
                        onVote={handleVote}
                        onFlag={handleFlag}
                        onRecall={handleRecall}
                        onTranslate={handleTranslate}
                        onReply={handleReply}
                    />
                ))}
                {loading && comments.length === 0 && (
                    <div className={styles.commentStatus}>{tUI('common.loading')}</div>
                )}
                {error && (
                    <div className={styles.commentStatus}>{error}</div>
                )}
                <div
                    className={styles.commentDivider}
                    data-has-comments={allCommentIds.length > 0 ? 'true' : 'false'}
                    aria-hidden="true"
                ></div>
                <div className={styles.commentRule}>{footerText}</div>
            </div>
            <LinearBlur
                side="bottom"
                strength={8}
                falloffPercentage={100}
                className={classNames(styles.commentBottomBlur, {
                    [styles.commentBottomBlurVisible]: commentBottomBlurVisible,
                })}
            />
            <div
                className={styles.commentInputBar}
                data-replying={replyQuoteShown ? 'true' : 'false'}
                ref={inputBarRef}
            >
                <div className={styles.commentInputStack}>
                    <div
                        className={styles.commentReplyQuoteShell}
                        data-visible={replyQuoteShown ? 'true' : 'false'}
                        aria-hidden={!replyQuoteShown}
                    >
                        <div className={styles.commentReplyQuote}>
                            {replyQuoteText}
                        </div>
                    </div>
                    <div className={styles.commentInputRow}>
                        <textarea
                            ref={inputRef}
                            className={styles.commentInput}
                            value={inputValue}
                            maxLength={COMMENT_MAX_LENGTH}
                            placeholder={tUI('detail.comments.placeholder')}
                            disabled={inputDisabled}
                            onChange={(event) => setInputValue(event.target.value)}
                            onKeyDown={handleKeyDown}
                            rows={1}
                        />
                        <button
                            type="button"
                            className={styles.commentSubmit}
                            disabled={inputDisabled || inputValue.trim().length === 0}
                            onClick={() => void handleSubmit()}
                            aria-label={tUI('detail.comments.submit')}
                        >
                            <SubmitIcon />
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default Comments;
