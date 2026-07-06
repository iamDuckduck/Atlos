import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { getTargetLang } from '@/utils/lang';
import { transUGCComments, type UGCComment } from '@/utils/ugcClient';
import { flatList, isVisible } from './commentsTree';

const AUTO_TRANS_TARGET_LANGS = new Set(['zh-cn', 'en-us', 'ru-ru', 'ja-jp', 'ko-kr']);

const shouldAutoTrans = (locale: string): boolean => (
    AUTO_TRANS_TARGET_LANGS.has(getTargetLang(locale))
);

const applyAutoTrans = (
    comments: UGCComment[],
    trans: Awaited<ReturnType<typeof transUGCComments>>,
): UGCComment[] => {
    const transById = new Map(
        trans
            .filter((item) => item.translatedContent)
            .map((item) => [item.commentId, item] as const),
    );
    if (transById.size === 0) return comments;

    const applyTo = (items: UGCComment[]): UGCComment[] => (
        items.map((comment) => {
            const transItem = transById.get(comment.id);
            const replies = comment.replies.length > 0 ? applyTo(comment.replies) : comment.replies;
            if (!transItem) {
                return replies === comment.replies ? comment : { ...comment, replies };
            }

            return {
                ...comment,
                replies,
                translatedContent: transItem.translatedContent,
                translationSourceLanguage: transItem.sourceLanguage,
                translationTargetLanguage: transItem.targetLanguage,
                translationHidden: false,
                translationStatus: undefined,
            };
        })
    );

    return applyTo(comments);
};

export const useAutoTrans = ({
    comments,
    enabled = true,
    locale,
    scopeKey,
    setComments,
}: {
    comments: UGCComment[];
    enabled?: boolean;
    locale: string;
    scopeKey: string;
    setComments: Dispatch<SetStateAction<UGCComment[]>>;
}) => {
    const requestRef = useRef('');

    useEffect(() => {
        if (!enabled || !scopeKey || !shouldAutoTrans(locale)) return;

        const targetLang = getTargetLang(locale);
        const commentIds = flatList(comments)
            .filter((comment) => isVisible(comment.status))
            .filter((comment) => !(
                comment.translatedContent
                && comment.translationTargetLanguage?.toLowerCase() === targetLang
            ))
            .map((comment) => comment.id);
        if (commentIds.length === 0) return;

        const requestKey = `${scopeKey}:${targetLang}:${commentIds.join(',')}`;
        if (requestRef.current === requestKey) return;
        requestRef.current = requestKey;

        let disposed = false;
        void transUGCComments(commentIds, targetLang)
            .then((items) => {
                if (disposed) return;
                setComments((current) => applyAutoTrans(current, items));
            })
            .catch(() => {
                // Auto translation is opportunistic; keep original comments on failure.
            });

        return () => {
            disposed = true;
        };
    }, [comments, enabled, locale, scopeKey, setComments]);
};
