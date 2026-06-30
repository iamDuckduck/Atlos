import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import styles from './comments.module.scss';
import { openOemAuthModal } from '@/component/login/authEvents';
import { useAuthStore } from '@/store/auth';
import type { SessionUser } from '@/component/login/authTypes';
import { useLocale, useTranslateUI } from '@/locale';
import { formatRelativeTime, parseDateLike } from '@/utils/timeFormat';
import type { IMarkerData } from '@/data/marker';
import {
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

type Props = {
    point: IMarkerData;
    pointName: string;
    active?: boolean;
};

const COMMENT_MAX_LENGTH = 199;

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

    return comments.map((item) => {
        if (item.id !== comment.parentId) return item;
        return {
            ...item,
            replyCount: item.replyCount + 1,
            replies: [...item.replies, comment],
        };
    });
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

const CommentAvatar = memo(({ comment }: { comment: UGCComment }) => (
    <span className={styles.commentAvatar} data-avt={getCommentAvatarIndex(comment)} aria-hidden="true"></span>
));

CommentAvatar.displayName = 'CommentAvatar';

type CommentItemProps = {
    comment: UGCComment;
    depth: number;
    isOwn: boolean;
    canInteract: boolean;
    actionPending: boolean;
    onVote: (comment: UGCComment, value: 1 | -1) => void;
    onFlag: (comment: UGCComment) => void;
    onRecall: (comment: UGCComment) => void;
    onTranslate: (comment: UGCComment) => void;
    isOwnComment: (comment: UGCComment) => boolean;
    isActionPending: (commentId: string) => boolean;
};

const CommentItem = memo(({
    comment,
    depth,
    isOwn,
    canInteract,
    actionPending,
    onVote,
    onFlag,
    onRecall,
    onTranslate,
    isOwnComment,
    isActionPending,
}: CommentItemProps) => {
    const tUI = useTranslateUI();
    const createdAt = useMemo(() => parseDateLike(comment.createdAt), [comment.createdAt]);
    const timeLabel = createdAt
        ? formatRelativeTime(createdAt, { precision: 'dateTime', agoDisplay: 'hover', agoLabel: tUI('idcard.ago') }).agoText
        : '';
    const statusLabel = getCommentStatusLabel(comment, timeLabel);
    const authorName = comment.author?.nickname || tUI('detail.comments.anonymous');
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

        return items;
    }, [
        actionPending,
        canInteract,
        canModerate,
        comment,
        isOwn,
        onFlag,
        onRecall,
        onTranslate,
        onVote,
        tUI,
    ]);

    return (
        <div className={classNames(styles.commentNode, { [styles.replyNode]: depth > 0 })}>
            <article className={styles.commentBubble} data-short-actions-root="true">
                <ShortActions
                    className={styles.commentActions}
                    anchorClassName={styles.commentActionsAnchor}
                    items={actions}
                    ariaLabel={tUI('detail.comments.actions')}
                    variant="floating"
                />
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
            {comment.replies?.map((reply) => (
                <CommentItem
                    key={reply.id}
                    comment={reply}
                    depth={depth + 1}
                    isOwn={isOwnComment(reply)}
                    canInteract={canInteract}
                    actionPending={isActionPending(reply.id)}
                    onVote={onVote}
                    onFlag={onFlag}
                    onRecall={onRecall}
                    onTranslate={onTranslate}
                    isOwnComment={isOwnComment}
                    isActionPending={isActionPending}
                />
            ))}
        </div>
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
    const loadFailedText = tUI('detail.comments.loadFailed');

    const hasComments = comments.length > 0;
    const inputDisabled = !active || submitting;
    const isOwnComment = useCallback((comment: UGCComment): boolean => {
        if (!user) return false;
        return comment.author?.publicUid === user.uid;
    }, [user]);
    const isActionPending = useCallback((commentId: string): boolean => (
        actionPendingIds.has(commentId)
    ), [actionPendingIds]);

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

    const requireAuth = useCallback(() => {
        if (isAuthenticated) return true;
        openOemAuthModal('login');
        return false;
    }, [isAuthenticated]);

    const handleSubmit = useCallback(async () => {
        const content = inputValue.trim();
        if (!content || submitting) return;
        if (!requireAuth()) return;

        setSubmitting(true);
        setError('');
        try {
            const submission = await submitUGCComment(point, content);
            setComments((current) => appendSubmittedComment(
                current,
                createPendingComment(point, content, submission, user),
            ));
            setInputValue('');
        } catch {
            setError(tUI('detail.comments.submitFailed'));
        } finally {
            setSubmitting(false);
        }
    }, [inputValue, point, requireAuth, submitting, tUI, user]);

    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        void handleSubmit();
    }, [handleSubmit]);

    const handleVote = useCallback((comment: UGCComment, value: 1 | -1) => {
        if (!requireAuth() || actionPendingIds.has(comment.id)) return;
        const nextVote: UGCCommentVoteValue = comment.viewerVote === value ? 0 : value;
        const previousVote = comment.viewerVote ?? 0;
        const previousScore = comment.score;
        patchComment(comment.id, (item) => ({
            ...item,
            viewerVote: nextVote,
            score: item.score + getVoteDelta(previousVote, nextVote),
        }));
        setCommentActionPending(comment.id, true);
        void voteUGCComment(comment.id, value)
            .then((patch) => {
                patchComment(comment.id, (item) => applyCommentPatch(item, patch));
            })
            .catch(() => {
                patchComment(comment.id, (item) => ({
                    ...item,
                    viewerVote: previousVote,
                    score: previousScore,
                }));
            })
            .finally(() => setCommentActionPending(comment.id, false));
    }, [actionPendingIds, patchComment, requireAuth, setCommentActionPending]);

    const handleFlag = useCallback((comment: UGCComment) => {
        if (!requireAuth() || actionPendingIds.has(comment.id)) return;
        const nextFlagged = !comment.flagged;
        patchComment(comment.id, (item) => ({
            ...item,
            flagged: nextFlagged,
            status: nextFlagged ? 'flagged' : item.status === 'flagged' ? 'active' : item.status,
        }));
        setCommentActionPending(comment.id, true);
        void toggleUGCCommentFlag(comment.id, nextFlagged)
            .then((patch) => {
                patchComment(comment.id, (item) => applyCommentPatch(item, patch));
            })
            .catch(() => {
                patchComment(comment.id, (item) => ({
                    ...item,
                    flagged: !nextFlagged,
                    status: !nextFlagged ? 'flagged' : item.status === 'flagged' ? 'active' : item.status,
                }));
            })
            .finally(() => setCommentActionPending(comment.id, false));
    }, [actionPendingIds, patchComment, requireAuth, setCommentActionPending]);

    const handleRecall = useCallback((comment: UGCComment) => {
        if (!requireAuth() || actionPendingIds.has(comment.id)) return;
        const nextRecallRequested = true;
        patchComment(comment.id, (item) => ({
            ...item,
            recallRequested: nextRecallRequested,
            status: isReviewingStatus(item.status) ? item.status : 'remove_request',
        }));
        setCommentActionPending(comment.id, true);
        const request = isReviewingStatus(comment.status)
            ? recallUGCComment(comment.id)
            : requestUGCCommentRemoval(comment.id);
        void request
            .then((patch) => {
                patchComment(comment.id, (item) => applyCommentPatch(item, patch));
            })
            .catch(() => {
                patchComment(comment.id, (item) => ({
                    ...item,
                    recallRequested: false,
                    status: item.status === 'remove_request' ? 'active' : item.status,
                }));
            })
            .finally(() => setCommentActionPending(comment.id, false));
    }, [actionPendingIds, patchComment, requireAuth, setCommentActionPending]);

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

    return (
        <section className={styles.commentsPanel} aria-label={`${pointName} ${tUI('detail.comments.title')}`}>
            <div className={styles.commentList} data-loading={loading ? 'true' : 'false'}>
                {comments.map((comment) => (
                    <CommentItem
                        key={comment.id}
                        comment={comment}
                        depth={0}
                        isOwn={isOwnComment(comment)}
                        canInteract={active}
                        actionPending={actionPendingIds.has(comment.id)}
                        onVote={handleVote}
                        onFlag={handleFlag}
                        onRecall={handleRecall}
                        onTranslate={handleTranslate}
                        isOwnComment={isOwnComment}
                        isActionPending={isActionPending}
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
            <div className={styles.commentInputBar}>
                <textarea
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
        </section>
    );
};

export default Comments;
