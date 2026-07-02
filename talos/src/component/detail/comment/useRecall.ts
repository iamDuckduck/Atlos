import { useCallback, type Dispatch, type SetStateAction } from 'react';
import {
    invalidateUGCCommentCache,
    recallUGCComment,
    requestUGCCommentRemoval,
    type UGCComment,
} from '@/utils/ugcClient';
import { isReviewing, removeTree } from './commentsTree';

type Args = {
    markerId: string;
    comments: UGCComment[];
    busyIds: Set<string>;
    replyTarget: UGCComment | null;
    requireAuth: () => boolean;
    setBusy: (commentId: string, pending: boolean) => void;
    setComments: Dispatch<SetStateAction<UGCComment[]>>;
    setReply: Dispatch<SetStateAction<UGCComment | null>>;
    clearSync: (commentIds: Set<string>) => void;
};

export const useRecall = ({
    markerId,
    comments,
    busyIds,
    replyTarget,
    requireAuth,
    setBusy,
    setComments,
    setReply,
    clearSync,
}: Args) => (
    useCallback((comment: UGCComment) => {
        if (!requireAuth() || busyIds.has(comment.id)) return;
        const previousComments = comments;
        const previousReplyTarget = replyTarget;
        const removal = removeTree(comments, comment.id);

        setComments(removal.comments);
        setReply((current) => (current && removal.removedIds.has(current.id) ? null : current));
        invalidateUGCCommentCache(markerId);
        clearSync(removal.removedIds);
        setBusy(comment.id, true);
        const request = isReviewing(comment.status)
            ? recallUGCComment(comment.id)
            : requestUGCCommentRemoval(comment.id);
        void request
            .then(() => undefined)
            .catch(() => {
                setComments(previousComments);
                setReply(previousReplyTarget);
            })
            .finally(() => setBusy(comment.id, false));
    }, [
        busyIds,
        clearSync,
        comments,
        markerId,
        replyTarget,
        requireAuth,
        setBusy,
        setComments,
        setReply,
    ])
);
